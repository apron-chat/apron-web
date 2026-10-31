import type { TerminalScreen } from './terminal-screen';

/** What a `TerminalFeed` writes to: a `TerminalScreen`. */
export type TerminalSink = Pick<TerminalScreen, 'reset' | 'write' | 'show'>;

/**
 * One terminal embed's text, decoded, for every screen that shows it: the one
 * in its message and, while it is open, the full-screen viewer's. It keeps
 * what was written since the last reset, so a screen attached later starts
 * from the same text (all 80 by 40 of a terminal's state follows from it) and
 * then gets what arrives, without reading the live text a second time.
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
		for (const screen of this.#screens) screen.write(text);
	}

	/** Replaces it with `output`, such as a finished embed's, from a fresh terminal. */
	show(output: string): void {
		this.#text = output;
		for (const screen of this.#screens) screen.show(output);
	}

	/** Shows the text so far on `screen`, a fresh one, then all that follows, until the function returned is called. */
	attach(screen: TerminalSink): () => void {
		if (this.#text) screen.show(this.#text);
		this.#screens.add(screen);
		return () => this.#screens.delete(screen);
	}
}
