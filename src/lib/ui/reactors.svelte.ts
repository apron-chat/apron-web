import type { Identity } from '$lib/protocol/types';

/**
 * The list of who reacted: one at a time, for whichever reaction chip was
 * long-pressed or right-clicked last. `ReactorsPopover` (mounted once, outside
 * the timeline so nothing clips it) draws the open request.
 */

export interface ReactorsRequest {
	/** The chip: the list sits beside it, and Escape returns focus to it. */
	anchor: HTMLElement;
	emoji: string;
	/** Read as the list draws, so reactions that arrive while it is open show in it. */
	reactors: () => Identity[];
}

class ReactorsState {
	/** The open list's request, if one is open. */
	current = $state.raw<ReactorsRequest | undefined>();

	isOpenFor(anchor: HTMLElement | undefined): boolean {
		return anchor !== undefined && this.current?.anchor === anchor;
	}

	/** Opens the list for this chip, closing any other. Opening it again leaves it open. */
	open(request: ReactorsRequest): void {
		if (!this.isOpenFor(request.anchor)) this.current = request;
	}

	/** Closes the list; `restoreFocus` (Escape) puts focus back on the chip. */
	close(restoreFocus = false): void {
		const current = this.current;
		if (!current) return;
		this.current = undefined;
		if (restoreFocus && current.anchor.isConnected) current.anchor.focus({ preventScroll: true });
	}
}

export const reactorsList = new ReactorsState();
