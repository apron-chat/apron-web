import type { TerminalScreen } from './terminal-screen';

/** What a `TerminalFeed` writes to: a `TerminalScreen`. */
export type TerminalSink = Pick<TerminalScreen, 'reset' | 'write' | 'show'>;

/**
 * How much of the text a feed keeps, in UTF-16 code units: about 256 KiB, more
 * than servers keep of a terminal's output (64 KiB on apron-server-go), so a
 * writer that sends many MiB cannot fill memory. A feed cuts its start once the
 * text passes that by a quarter, so a stream does not copy it on every write.
 */
export const TERMINAL_FEED_KEEP = 256 * 1024;

/**
 * The last `limit` code units of `text`, cut as the server cuts a terminal's
 * output (`keep_last`, §4.8.6): from its first control character (below
 * U+0020), or, with none, from its first whole character.
 */
export function keepLast(text: string, limit: number): string {
	if (text.length <= limit) return text;
	const tail = text.slice(-limit);
	for (let i = 0; i < tail.length; i++) if (tail.charCodeAt(i) < 0x20) return tail.slice(i);
	const first = tail.charCodeAt(0);
	return first >= 0xdc00 && first <= 0xdfff ? tail.slice(1) : tail;
}

/**
 * One terminal embed's text, decoded, for every screen that shows it: the one
 * in its message and, while it is open, the full-screen viewer's. It keeps
 * what was written since the last reset, so a screen attached later starts
 * from the same text (all 80 by 40 of a terminal's state follows from it) and
 * then gets what arrives, without reading the live text a second time. Past
 * `TERMINAL_FEED_KEEP` it keeps the last part (`keepLast`): a screen attached
 * later starts from the cut, as a reader that reconnects starts from the part
 * the server kept.
 */
export class TerminalFeed {
	#text = '';
	readonly #screens = new Set<TerminalSink>();

	/** The text since the last reset, as written. */
	get text(): string {
		return this.#text;
	}

	/** Starts afresh, such as for a reconnect's new response. */
	reset(): void {
		this.#text = '';
		for (const screen of this.#screens) screen.reset();
	}

	/** The next of the text. */
	write(text: string): void {
		if (!text) return;
		this.#text += text;
		if (this.#text.length > TERMINAL_FEED_KEEP * 1.25) this.#text = keepLast(this.#text, TERMINAL_FEED_KEEP);
		for (const screen of this.#screens) screen.write(text);
	}

	/** Replaces it with `output`, such as a finished embed's, from a fresh terminal. */
	show(output: string): void {
		this.#text = keepLast(output, TERMINAL_FEED_KEEP);
		for (const screen of this.#screens) screen.show(output);
	}

	/** Shows the text so far on `screen`, a fresh one, then all that follows, until the function returned is called. */
	attach(screen: TerminalSink): () => void {
		if (this.#text) screen.show(this.#text);
		this.#screens.add(screen);
		return () => this.#screens.delete(screen);
	}
}
