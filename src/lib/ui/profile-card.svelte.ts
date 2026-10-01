/**
 * The profile card: one at a time, for whichever user mention, sender or
 * member opened it last. `ProfileCard` (mounted once, outside the timeline so
 * nothing clips it) draws the open request; triggers open and toggle it here.
 */

export interface ProfileCardRequest {
	/** What was clicked: the card sits beside it, and Escape returns focus to it. */
	anchor: HTMLElement;
	userId: string;
}

class ProfileCardState {
	/** The open card's request, if one is open. */
	current = $state.raw<ProfileCardRequest | undefined>();

	isOpenFor(anchor: HTMLElement | undefined): boolean {
		return anchor !== undefined && this.current?.anchor === anchor;
	}

	/** Opens the card for this trigger, closing any other; a second press closes it. */
	toggle(request: ProfileCardRequest): void {
		this.current = this.isOpenFor(request.anchor) ? undefined : request;
	}

	/** Closes the card; `restoreFocus` (Escape) puts focus back on what opened it. */
	close(restoreFocus = false): void {
		const current = this.current;
		if (!current) return;
		this.current = undefined;
		if (restoreFocus && current.anchor.isConnected) current.anchor.focus({ preventScroll: true });
	}
}

export const profileCard = new ProfileCardState();

/**
 * Opens the card for the user a button names with `data-user-id` (a mention
 * chip, a sender's name or avatar, a member), if the click landed on one.
 * Mentions drawn as spans, as in a reply's quote, only read. Returns whether
 * it opened.
 */
export function openProfileFrom(target: EventTarget | null): boolean {
	const anchor = (target as HTMLElement | null)?.closest?.<HTMLElement>('button[data-user-id]');
	const userId = anchor?.dataset.userId;
	if (!anchor || !userId) return false;
	profileCard.toggle({ anchor, userId });
	return true;
}
