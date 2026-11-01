import { untrack } from 'svelte';
import type { ChatClient } from '$lib/protocol/client';
import { isJsonObject, type JsonObject } from '$lib/protocol/types';
import { LiveTyping, canWriteLiveText, type LiveTypingEnd } from './live-typing';

/**
 * Live typing (`/live`, capability `embed:append`), loaded on demand the first time it is used, so that the composer
 * costs nothing more until then. The message the composer types live is posted at once with an `append` embed
 * (§4.8.5) whose live text follows the draft (`LiveTyping`), so the timeline shows it, and everyone sees it grow and
 * change as it is typed. It belongs to the pane it was started in, and Send there finishes it; leaving the pane
 * finishes it as Send would.
 */

/** MDN's page on streaming uploads (`duplex`), with which browsers have them: what `/live` points to where it can't write. */
const STREAMING_UPLOADS_URL = 'https://developer.mozilla.org/en-US/docs/Web/API/Request/duplex#browser_compatibility';

/** What live typing needs from the page: its client, its open pane, the draft there, and how it shows what happened. */
export interface LiveComposerHost {
	client(): ChatClient | undefined;
	/** The open pane's draft key (reactive), or undefined with no pane. */
	paneKey(): string | undefined;
	/** The open pane's draft as typed, its mentions, and the message it replies to (reactive). */
	draft(): { text: string; mentions: string[]; reply?: string };
	/** Whether the server takes saves (capability `edit`). */
	canEdit(): boolean;
	/** Empties `key`'s draft: its text and reply, kept files aside. */
	forget(key: string): void;
	/** Gives `key`'s draft back, as a failed send does, when nothing else was typed there since. */
	restore(key: string, text: string, reply: string | undefined): void;
	/** A live message started in the open pane: the timeline follows it and the composer keeps the focus. */
	started(roomId: string): void;
	error(cause: unknown, fallback?: string): void;
}

/** A live message: its session, its pane, and the draft's mentions and reply as last seen, for the save that finishes it. */
interface LiveMessage {
	typing: LiveTyping;
	key: string;
	mentions: string[];
	/** A reply picked while it was live: the save that finishes it sets it. */
	reply?: string;
}

export class LiveComposer {
	#current = $state.raw<LiveMessage | undefined>();
	readonly #host: LiveComposerHost;
	/** The open pane's draft is the live message. */
	readonly #composing = $derived.by(() => this.#current !== undefined && this.#current.key === this.#host.paneKey());

	constructor(host: LiveComposerHost) {
		this.#host = host;
		$effect.root(() => {
			// Each change to the live draft goes out as it is made: typing, a chip, an emoji, a paste. Its mentions and
			// reply are kept with it, for when it finishes, from here or from another pane.
			$effect(() => {
				if (!this.#composing) return;
				const { text, mentions, reply } = host.draft();
				untrack(() => {
					const current = this.#current;
					if (!current) return;
					current.mentions = mentions;
					current.reply = reply;
					current.typing.update(text);
				});
			});
			// Leaving the pane finishes its live message, as Send would, with what was typed.
			$effect(() => {
				if (this.#current && !this.#composing) untrack(() => this.#finish());
			});
		});
	}

	/** The open pane's draft is the live message: Send finishes it, and the composer shows it as live. */
	get composing(): boolean {
		return this.#composing;
	}

	/**
	 * `/live` in the open pane, `key`, of room `roomId`: the composer empties, and what is typed next is the room's
	 * newest message, live, until Send. `joining` is the join a message there waits for, if any. A browser that can't
	 * stream an upload gets a notice that says so, and nothing else happens.
	 */
	start(chat: ChatClient, roomId: string, key: string, reply: string | undefined, joining?: Promise<unknown>): void {
		if (!canWriteLiveText()) {
			chat.notify(roomId, `Live typing needs a browser that can stream an upload as it is written, over HTTP/2 or later ([which browsers can](${STREAMING_UPLOADS_URL})).`, 'markdown');
			return;
		}
		this.#finish();
		this.#host.forget(key);
		chat.sendTyping(roomId, false);
		this.#host.started(roomId);
		const post = () => postAppend(chat, roomId, reply);
		const typing: LiveTyping = new LiveTyping('', { start: () => (joining ? joining.then(post) : post()) }, (end) => this.#ended(chat, current, end));
		const current: LiveMessage = { typing, key, mentions: [] };
		this.#current = current;
	}

	/** Send on the live message: the draft is its final text. */
	send(): void {
		const current = this.#current;
		if (!current) return;
		const { text, mentions, reply } = this.#host.draft();
		current.mentions = mentions;
		current.reply = reply;
		current.typing.update(text);
		this.#finish();
	}

	/** The composer empties at once; if the message never got going, `#ended` gives the draft back. */
	#finish(): void {
		const current = this.#current;
		const chat = this.#host.client();
		if (!current) return;
		this.#current = undefined;
		this.#host.forget(current.key);
		void current.typing.finish().then((messageId) => {
			if (messageId && chat) this.#settle(chat, current, messageId);
		});
	}

	/**
	 * A live message's final text, once its session ended. With capability `edit` a save puts the draft in
	 * `body.text`, with its mentions and any reply picked meanwhile, and without the embed, which ends the text (§4.8.5:
	 * the composer's own state is the text it means), or deletes it when nothing was typed; then the write ends. A save
	 * that fails gives the draft back. Without `edit`, the write ends, and the server keeps what arrived.
	 */
	#settle(chat: ChatClient, current: LiveMessage, messageId: string): void {
		const { typing, mentions, reply } = current;
		const text = typing.liveText;
		if (!this.#host.canEdit()) {
			typing.close();
			return;
		}
		const saved = text.trim()
			? chat.saveMessage(messageId, { body: { text, format: 'markdown', ...(mentions.length ? { mentions } : {}) }, ...(reply ? { reply_to: reply } : {}) })
			: chat.deleteMessage(messageId);
		saved.promise.then(() => typing.close(), (cause: unknown) => {
			typing.close();
			this.#host.restore(current.key, typing.text, reply);
			this.#host.error(cause, 'Unable to finish the live message');
		});
	}

	/**
	 * A live message that stopped by itself. One that never got going is taken back, where it can be, and the draft
	 * is kept, or given back if it was already sent, as an ordinary draft. One the server ended (a limit, or the
	 * connection dropped after text went out) keeps what arrived, and is finished as Send would, from the draft.
	 */
	#ended(chat: ChatClient, current: LiveMessage, end: LiveTypingEnd): void {
		if (this.#current === current) this.#current = undefined;
		if (end.kind === 'failed') {
			if (end.messageId && this.#host.canEdit()) chat.deleteMessage(end.messageId).promise.catch(() => undefined);
			this.#host.restore(current.key, current.typing.text, current.reply);
			this.#host.error(`Live typing stopped: ${end.reason}`);
			return;
		}
		this.#host.forget(current.key);
		this.#host.error(`The live message ended early: ${end.reason}`);
		if (end.messageId) this.#settle(chat, current, end.messageId);
	}
}

/**
 * Posts an empty Markdown message whose text continues as live text (§4.8.5), replying to `reply` if set. Resolves
 * with the message and the `write_url` its result lists for the sender alone (§4.8.3).
 */
async function postAppend(chat: ChatClient, roomId: string, reply: string | undefined): Promise<{ messageId: string; writeUrl: string }> {
	const result = await chat.send(roomId, '', 'markdown', { embeds: [{ kind: 'append' }], ...(reply ? { replyTo: reply } : {}) }).promise;
	const embeds: unknown[] = Array.isArray(result.embeds) ? result.embeds : [];
	const written = embeds.find((embed): embed is JsonObject => isJsonObject(embed) && embed.kind === 'append' && typeof embed.write_url === 'string');
	if (!written) throw new Error('The server did not accept the live text');
	return { messageId: result.message_id, writeUrl: written.write_url as string };
}
