/**
 * The full-screen terminal viewer: one at a time, opened from a terminal
 * embed's Expand (or a tap on its screen, on a touch screen). It shows the
 * embed's own `TerminalFeed`, so it follows the same live text without
 * reading it again. `TerminalViewerHost` (mounted once, in the page) draws it.
 */
import type { TerminalFeed } from './terminal-feed';
import { Viewer } from './viewer.svelte';

/** What the viewer shows of a terminal embed: read as it changes (live, then finished). */
export interface TerminalView {
	readonly title?: string;
	/** Still being written: the Live badge. */
	readonly live: boolean;
	/** What the header says once it isn't live: Finished, Ended or Unavailable. */
	readonly status: string;
	readonly feed: TerminalFeed;
}

export const terminalViewer = new Viewer<TerminalView>();
