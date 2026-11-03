import { AnchoredPopover, type PopoverRequest } from './popover.svelte';

/**
 * The server pane: what is known of the server you're connected to, opened from the rooms list's head.
 * `ServerPane` (mounted once, outside the sidebar so nothing clips it) draws it; the head opens and closes it here.
 */
class ServerPaneState extends AnchoredPopover<PopoverRequest> {
	/** What opened it, while it's open: it sits beside it, and Escape returns focus to it. */
	get anchor(): HTMLElement | undefined {
		return this.current?.anchor;
	}
}

export const serverPane = new ServerPaneState();
