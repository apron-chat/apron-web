import { isHigh, lastCodePoint, writeLiveText } from '$lib/protocol/live-text';

/**
 * The edit that turns live text the sender wrote, `sent`, into `next` (§4.8.5): backspaces for what follows their
 * common start, then the rest of `next`; or a form feed and all of `next`, when that is shorter. Backspaces count code
 * points, as readers apply them (`editLiveText`), so a surrogate pair is never split. Backspace and form feed in the
 * texts themselves would read as edits, so a sender leaves them out of both (`liveTextOf`).
 */
export function liveEdit(sent: string, next: string): string {
	if (sent === next) return '';
	const shorter = Math.min(sent.length, next.length);
	let common = 0;
	while (common < shorter && sent.charCodeAt(common) === next.charCodeAt(common)) common++;
	// A shared high surrogate whose low ones differ is half a character: it goes too.
	if (common > 0 && isHigh(sent.charCodeAt(common - 1)) && common < sent.length) common--;
	let removed = 0;
	for (let end = sent.length; end > common; end = lastCodePoint(sent, end)) removed++;
	const edit = '\b'.repeat(removed) + next.slice(common);
	return removed > 0 && next.length + 1 < edit.length ? `\f${next}` : edit;
}

/** A composer's text as it goes out as live text: without backspace and form feed, which would read as edits (§4.8.5). */
export function liveTextOf(text: string): string {
	return text.replace(/[\b\f]/g, '');
}

/** How a live typing session reaches the server: posting its message, and writing its live text. */
export interface LiveTypingTransport {
	/** Posts the message with an `append` embed (§4.8.5); resolves with its ID and the embed's `write_url`. */
	start(): Promise<{ messageId: string; writeUrl: string }>;
	/** Streams `body` to `writeUrl` (`writeLiveText`): resolves with the server's response, which may come before the body ends. */
	write?(writeUrl: string, body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<Response>;
}

/** Why a session ended without being finished: the write could not be made, or the server ended the text first. */
export interface LiveTypingEnd {
	/** `failed`: the message or its write never got going. `ended`: the server ended the text, keeping what arrived. */
	kind: 'failed' | 'ended';
	/** The message, when it was posted. */
	messageId?: string;
	reason: string;
}

/**
 * The composer in live typing mode (`/live`): one message, posted at once with an `append` embed (§4.8.5), whose live
 * text follows the composer as it is typed. Each change goes out as the edit that turns what was sent into the new
 * text (`liveEdit`): backspaces, or a form feed, then what was added. Readers, the timeline included, see the message
 * grow and change in place. `finish` ends the session for Send, and the caller saves the message's final text.
 */
export class LiveTyping {
	/** The message, once posted. */
	messageId: string | undefined;
	/** The live text written so far, without its edits: what readers show after `body.text`. */
	#sent = '';
	/** The composer's latest text, as typed. */
	#text: string;
	/** That as live text (`liveTextOf`), written once the write starts. */
	#latest: string;
	#body: ReadableStreamDefaultController<Uint8Array> | undefined;
	#done = false;
	readonly #abort = new AbortController();
	readonly #encoder = new TextEncoder();
	/** Settles once the message is posted and its write has started, or failed to. */
	readonly started: Promise<void>;

	constructor(text: string, transport: LiveTypingTransport, onend: (end: LiveTypingEnd) => void) {
		this.#text = text;
		this.#latest = liveTextOf(text);
		const write = transport.write ?? writeLiveText;
		const end = (kind: LiveTypingEnd['kind'], reason: string) => {
			if (this.#done) return;
			this.#done = true;
			onend({ kind, reason, ...(this.messageId ? { messageId: this.messageId } : {}) });
		};
		this.started = transport.start().then(({ messageId, writeUrl }) => {
			this.messageId = messageId;
			if (this.#done) return;
			const body = new ReadableStream<Uint8Array>({ start: (controller) => void (this.#body = controller) });
			write(writeUrl, body, this.#abort.signal).then(
				async (response) => end('ended', (await reason(response)) || 'The live message ended'),
				(cause: unknown) => end('failed', cause instanceof Error && cause.name !== 'TypeError' ? cause.message : 'This connection can’t stream live text')
			);
			this.update(this.#text);
		}, (cause: unknown) => end('failed', cause instanceof Error && cause.message ? cause.message : 'Unable to start the live message'));
	}

	/** Still following the composer: not finished, and not ended by the server or a failure. */
	get active(): boolean {
		return !this.#done;
	}

	/** The composer's latest text, as typed. */
	get text(): string {
		return this.#text;
	}

	/** The composer's text changed: the edit to it goes out, once the write has started. */
	update(text: string): void {
		if (this.#done) return;
		this.#text = text;
		this.#latest = liveTextOf(text);
		if (!this.#body) return;
		const edit = liveEdit(this.#sent, this.#latest);
		if (!edit) return;
		this.#body.enqueue(this.#encoder.encode(edit));
		this.#sent = this.#latest;
	}

	/**
	 * Ends the session for Send: what is written stays, and no edit follows. Resolves with the message once its write
	 * started, for the caller to save its final text, then `close`; undefined when the session already ended (`onend`
	 * told why).
	 */
	async finish(): Promise<string | undefined> {
		await this.started;
		if (this.#done) return undefined;
		this.#done = true;
		return this.messageId;
	}

	/** Ends the write: the body ends, so the text does, and the server keeps what arrived (§4.8.3). */
	close(): void {
		this.#done = true;
		try {
			this.#body?.close();
		} catch {
			// Already closed or errored, when the server ended the write first.
		}
		this.#body = undefined;
	}

	/** Gives up on the write at once, as when the message is deleted. */
	abort(): void {
		this.#done = true;
		this.#abort.abort();
	}
}

/** The server's word on an ended write, a line of its body at most. */
async function reason(response: Response): Promise<string> {
	if (response.ok) return '';
	try {
		return (await response.text()).trim().split('\n')[0].slice(0, 200);
	} catch {
		return '';
	}
}
