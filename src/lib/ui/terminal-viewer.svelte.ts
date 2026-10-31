/**
 * The full-screen terminal viewer: one at a time, opened from a terminal
 * embed's Expand (or a tap on its screen, on a touch screen). It shows the
 * embed's own `TerminalFeed`, so it follows the same live text without
 * reading it again. `TerminalViewerHost` (mounted once, in the page) draws it.
 */
import type { TerminalFeed } from './terminal-feed';

/** What the viewer shows of a terminal embed: read as it changes (live, then finished). */
export interface TerminalView {
	readonly title?: string;
	/** Still being written: the Live badge. */
	readonly live: boolean;
	/** What the header says once it isn't live: Finished, Ended or Unavailable. */
	readonly status: string;
	readonly feed: TerminalFeed;
}

class TerminalViewer {
	open = $state(false);
	view = $state.raw<TerminalView>();
	#opener: HTMLElement | undefined;

	/** Opens on `view`; `opener` (the embed's Expand) gets focus back once it closes. */
	show(view: TerminalView, opener?: HTMLElement): void {
		this.view = view;
		this.#opener = opener;
		this.open = true;
	}

	/** The embed went (its message did, or its room closed): it closes, if it shows that one. */
	forget(view: TerminalView): void {
		if (this.view === view) this.open = false;
	}

	/** It closed: focus goes back to the Expand that opened it, where it still is. */
	closed(): void {
		this.open = false;
		this.view = undefined;
		const opener = this.#opener;
		this.#opener = undefined;
		if (opener?.isConnected) opener.focus({ preventScroll: false });
	}
}

export const terminalViewer = new TerminalViewer();
