import { AnchoredPopover } from './popover.svelte';

/**
 * The profile card: one at a time, for whichever user mention, sender or
 * member opened it last. `ProfileCard` (mounted once, outside the timeline so
 * nothing clips it) draws the open request; triggers open and toggle it here.
 */

export interface ProfileCardRequest {
	/** What was clicked: the card sits beside it, and Escape returns focus to it. */
	anchor: HTMLElement;
	userId: string;
	/**
	 * Whether they are a member of the open room, when that was looked up
	 * (a link's user, §4.2.1): a large room's members may leave them out.
	 */
	member?: boolean;
}

export const profileCard = new AnchoredPopover<ProfileCardRequest>();

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
