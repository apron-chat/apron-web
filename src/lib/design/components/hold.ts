import type { Attachment } from 'svelte/attachments';

/** How long a finger rests before a press counts as held. */
export const LONG_PRESS_MS = 500;
/** How far a held finger may drift before the press counts as a scroll: a finger is never quite still. */
export const SLOP_PX = 10;

/** Where a hold happened: the pointer's place, or the element's own corner for the context menu key (`keyboard`). */
export interface HoldAt {
	x: number;
	y: number;
	keyboard?: true;
}

/**
 * A menu's way in, on whatever element it's attached to: a right-click or the context menu key (`contextmenu`, which
 * is also Android's own long press), or a touch held still for LONG_PRESS_MS. `onhold` gets where; return false from
 * it to let the press be the browser's after all. The click that ends a long press is swallowed, so the element's own
 * click (opening something) doesn't follow its menu. `onhold` gets the element too: by then a long press's event has
 * finished, and its `currentTarget` is gone.
 */
export function hold(onhold: (at: HoldAt, node: HTMLElement) => boolean | void): Attachment<HTMLElement> {
	return (node) => {
		let press: { timer: ReturnType<typeof setTimeout>; x: number; y: number } | undefined;
		let swallow = false;
		let touch = false;

		const cancel = () => {
			if (!press) return;
			clearTimeout(press.timer);
			press = undefined;
		};
		const pointerdown = (event: PointerEvent) => {
			cancel();
			swallow = false;
			touch = event.pointerType === 'touch';
			if (!touch) return;
			const { clientX: x, clientY: y } = event;
			press = {
				timer: setTimeout(() => {
					press = undefined;
					if (node.isConnected && onhold({ x, y }, node) !== false) swallow = true;
				}, LONG_PRESS_MS),
				x,
				y
			};
		};
		const pointermove = (event: PointerEvent) => {
			if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > SLOP_PX) cancel();
		};
		const contextmenu = (event: MouseEvent) => {
			// A touch already held opened the menu; Android's own long press follows it.
			if (swallow) return event.preventDefault();
			cancel();
			// The context menu key has no pointer: the element's own corner, as a menu button's would be.
			const keyed = event.clientX === 0 && event.clientY === 0;
			const rect = node.getBoundingClientRect();
			const at: HoldAt = keyed ? { x: rect.left + 8, y: rect.bottom, keyboard: true } : { x: event.clientX, y: event.clientY };
			if (onhold(at, node) === false) return;
			event.preventDefault();
			if (touch) swallow = true;
		};
		const click = (event: MouseEvent) => {
			if (!swallow) return;
			swallow = false;
			event.preventDefault();
			event.stopPropagation();
		};

		node.addEventListener('pointerdown', pointerdown);
		node.addEventListener('pointermove', pointermove);
		node.addEventListener('pointerup', cancel);
		node.addEventListener('pointercancel', cancel);
		node.addEventListener('contextmenu', contextmenu);
		// Capture, so it's swallowed before the element's own handlers, and those of what's inside it, see it.
		node.addEventListener('click', click, true);
		return () => {
			cancel();
			node.removeEventListener('pointerdown', pointerdown);
			node.removeEventListener('pointermove', pointermove);
			node.removeEventListener('pointerup', cancel);
			node.removeEventListener('pointercancel', cancel);
			node.removeEventListener('contextmenu', contextmenu);
			node.removeEventListener('click', click, true);
		};
	};
}
