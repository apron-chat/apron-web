/**
 * The server pane: what is known of the server you're connected to, opened from the rooms list's head.
 * `ServerPane` (mounted once, outside the sidebar so nothing clips it) draws it; the head opens and closes it here.
 */
class ServerPaneState {
	/** What opened it, while it's open: it sits beside it, and Escape returns focus to it. */
	anchor = $state.raw<HTMLElement | undefined>();

	/** Opens it beside `anchor`; a second press closes it. */
	toggle(anchor: HTMLElement): void {
		this.anchor = this.anchor === anchor ? undefined : anchor;
	}

	/** Closes it; `restoreFocus` (Escape) puts focus back on what opened it. */
	close(restoreFocus = false): void {
		const anchor = this.anchor;
		if (!anchor) return;
		this.anchor = undefined;
		if (restoreFocus && anchor.isConnected) anchor.focus({ preventScroll: true });
	}
}

export const serverPane = new ServerPaneState();
