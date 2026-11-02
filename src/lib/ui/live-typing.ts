import { lastCodePoint, routedLiveFetch } from '$lib/protocol/live-text';

/**
 * The edit that turns live text the sender wrote, `sent`, into `next` (§4.8.5), as typing makes it: what was typed
 * at the end goes as it is, and one character deleted from the end (one grapheme, such as an emoji with its skin
 * tone) as one backspace per code point, as readers apply them (`editLiveText`). Any other change replaced text: a
 * selection deleted or typed over, a word removed at once, an edit before the end. That goes as a form feed and all
 * of `next`, a full reset to what the composer shows. Backspace and form feed in the texts themselves would read as
 * edits, so a sender leaves them out of both (`liveTextOf`).
 */
export function liveEdit(sent: string, next: string): string {
	if (sent === next) return '';
	if (next.startsWith(sent)) return next.slice(sent.length);
	if (sent.startsWith(next) && graphemes(sent.slice(next.length)) === 1) {
		let removed = 0;
		for (let end = sent.length; end > next.length; end = lastCodePoint(sent, end)) removed++;
		return '\b'.repeat(removed);
	}
	return `\f${next}`;
}

/** How many characters, as a reader sees them (grapheme clusters), `text` holds; code points where the browser can't tell. */
function graphemes(text: string): number {
	if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length;
	return [...text].length;
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
	write?(writeUrl: string, body: ReadableStream<Uint8Array>): Promise<Response>;
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
	/** Some text went out on the write. */
	#wrote = false;
	readonly #encoder = new TextEncoder();
	/** Settles once the message is posted and its write has started, or failed to. */
	readonly started: Promise<void>;

	constructor(text: string, transport: LiveTypingTransport, onend: (end: LiveTypingEnd) => void) {
		this.#text = text;
		this.#latest = liveTextOf(text);
		const write = transport.write ?? writeLiveText;
		const end = (kind: LiveTypingEnd['kind'], reason: string) => {
			if (this.#done) return;
			this.close();
			onend({ kind, reason, ...(this.messageId ? { messageId: this.messageId } : {}) });
		};
		this.started = transport.start().then(({ messageId, writeUrl }) => {
			this.messageId = messageId;
			if (this.#done) return;
			const body = new ReadableStream<Uint8Array>({ start: (controller) => void (this.#body = controller) });
			write(writeUrl, body).then(
				async (response) => end('ended', (await reason(response)) || 'the server ended it'),
				// Once text went out, the server keeps what arrived (§4.8.5): the message stands, so the text ended.
				(cause: unknown) => this.#wrote
					? end('ended', 'the connection to the server dropped')
					: end('failed', cause instanceof Error && cause.name !== 'TypeError' ? cause.message : 'this connection can’t stream live text')
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

	/** That as it goes out as live text (`liveTextOf`): what a save that ends it puts in `body.text`, so readers keep what they saw. */
	get liveText(): string {
		return this.#latest;
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
		this.#wrote = true;
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
}

/** The server's word on an ended write, a line of its body at most: some servers say why with a success status too. */
async function reason(response: Response): Promise<string> {
	try {
		return (await response.text()).trim().split('\n')[0].slice(0, 200);
	} catch {
		return '';
	}
}

/**
 * Whether this browser can write live text: a `PUT` whose body streams in as it is typed (`fetch` with a
 * `ReadableStream` body, `duplex: 'half'`), which browsers do only over HTTP/2 or later. The preview's in-memory server
 * reads any body (`setLiveFetch`), so there it always can.
 */
export function canWriteLiveText(): boolean {
	if (routedLiveFetch()) return true;
	if (typeof Request === 'undefined' || typeof ReadableStream === 'undefined') return false;
	try {
		let duplex = false;
		const init = { body: new ReadableStream(), method: 'POST', get duplex() { duplex = true; return 'half'; } };
		// A browser that reads the stream as a string gives the request a text Content-Type.
		const typed = new Request('data:,', init as RequestInit).headers.has('Content-Type');
		return duplex && !typed;
	} catch {
		return false;
	}
}

/**
 * Writes live text (§4.8.3): `body` streams to `write_url` as a `PUT`, and its end ends the text. Resolves with the
 * server's response, which may come before the body ends (the text reached a limit, or a save removed the embed), and
 * rejects when the request could not be made, such as over HTTP/1.1, where browsers stream no request body.
 */
export function writeLiveText(writeUrl: string, body: ReadableStream<Uint8Array>, signal?: AbortSignal): Promise<Response> {
	const init = { method: 'PUT', body, duplex: 'half', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, credentials: 'omit', cache: 'no-store', ...(signal ? { signal } : {}) };
	return (routedLiveFetch() ?? fetch)(writeUrl, init as RequestInit);
}
