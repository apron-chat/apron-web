import type { Identity } from '$lib/protocol/types';
import { AnchoredPopover } from './popover.svelte';

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

/** Opening it again for the same chip leaves it open (`open`). */
export const reactorsList = new AnchoredPopover<ReactorsRequest>();

/**
 * Lists who reacted with `emoji` beside its chip, read from the message's
 * current chips (`chips`) as the list draws, so the open list follows changes.
 */
export function showReactors(anchor: HTMLElement, emoji: string, chips: () => readonly { emoji: string; reactors: Identity[] }[]): void {
	reactorsList.open({ anchor, emoji, reactors: () => chips().find((chip) => chip.emoji === emoji)?.reactors ?? [] });
}
