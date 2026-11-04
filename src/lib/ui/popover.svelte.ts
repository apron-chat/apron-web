/** What opens a popover: the element it sits beside, which Escape returns focus to, and whatever else it shows. */
export interface PopoverRequest {
	anchor: HTMLElement;
}

/** Every anchored popover on the page: one is open at a time. */
const popovers = new Set<{ current: unknown }>();

/**
 * A popover opened from an element on the page (a person's card, the emoji picker, who reacted, the server pane),
 * drawn once outside whatever opened it so nothing clips it: `current` is the open request. One is open at a time,
 * page-wide: opening any closes the others, as a press outside them would.
 */
export class AnchoredPopover<R extends PopoverRequest> {
	/** The open request, if one is open. */
	current = $state.raw<R | undefined>();

	constructor() {
		popovers.add(this);
	}

	isOpenFor(anchor: HTMLElement | undefined): boolean {
		return anchor !== undefined && this.current?.anchor === anchor;
	}

	/** Opens it for `request`'s anchor, closing any other popover. Opening it again for the same anchor leaves it open. */
	open(request: R): void {
		if (this.isOpenFor(request.anchor)) return;
		for (const other of popovers) if (other !== this) other.current = undefined;
		this.current = request;
	}

	/** Opens it for this trigger, as `open`; a second press on the same one closes it. */
	toggle(request: R): void {
		if (this.isOpenFor(request.anchor)) this.current = undefined;
		else this.open(request);
	}

	/** Closes it; `restoreFocus` (Escape) puts focus back on what opened it. */
	close(restoreFocus = false): void {
		const current = this.current;
		if (!current) return;
		this.current = undefined;
		if (restoreFocus && current.anchor.isConnected) current.anchor.focus({ preventScroll: true });
	}

	/** Closes it only if `anchor` opened it: its owner is going away. */
	release(anchor: HTMLElement | undefined): void {
		if (this.isOpenFor(anchor)) this.current = undefined;
	}
}
