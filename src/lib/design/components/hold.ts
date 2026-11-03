import type { Attachment } from 'svelte/attachments';

/** How long a finger rests before a press counts as held. */
export const LONG_PRESS_MS = 500;
/** How far a held finger may drift before the press counts as a scroll: a finger is never quite still. */
export const SLOP_PX = 10;

/** The long press under way, page-wide: one finger holds at a time. */
let press: { timer: ReturnType<typeof setTimeout>; x: number; y: number } | undefined;

/**
 * A touch held still, the one way every long press here starts: it fires once a finger has rested LONG_PRESS_MS
 * without drifting past SLOP_PX (a scroll, then). One at a time, page-wide: another press starts over. What a long
 * press opens wires its own listeners to it (`hold` below, or delegated ones on rows drawn by the hundred).
 */
export const longPress = {
	/** Starts a long press at `event`'s place, running `fire` if it is held. Returns it, for `cancel`. */
	start(event: PointerEvent, fire: () => void): object {
		longPress.cancel();
		const pressed = {
			timer: setTimeout(() => {
				if (press === pressed) press = undefined;
				fire();
			}, LONG_PRESS_MS),
			x: event.clientX,
			y: event.clientY
		};
		press = pressed;
		return pressed;
	},
	/** A finger that moved: past SLOP_PX it is scrolling, and no long press fires. */
	move(event: PointerEvent): void {
		if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > SLOP_PX) longPress.cancel();
	},
	/** Ends the long press under way; with `pressed`, only if it is still that one (an element going ends only its own). */
	cancel(pressed?: object): void {
		if (!press || (pressed !== undefined && press !== pressed)) return;
		clearTimeout(press.timer);
		press = undefined;
	}
};

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
		let swallow = false;
		/** The long press this element started, if any. */
		let pressed: object | undefined;

		const cancel = () => longPress.cancel(pressed);
		const pointerdown = (event: PointerEvent) => {
			cancel();
			swallow = false;
			if (event.pointerType !== 'touch') return;
			const { clientX: x, clientY: y } = event;
			pressed = longPress.start(event, () => {
				if (node.isConnected && onhold({ x, y }, node) !== false) swallow = true;
			});
		};
		const pointermove = (event: PointerEvent) => longPress.move(event);
		const contextmenu = (event: MouseEvent) => {
			// A touch already held opened the menu; Android's own long press follows it.
			if (swallow) return event.preventDefault();
			cancel();
			// The context menu key (or Shift+F10) has no pointer: Chromium says so with no `pointerType`, Firefox with a
			// MouseEvent at 0, 0. It opens at the element's start corner, as a menu button's would.
			const pointerType = (event as PointerEvent).pointerType;
			const keyed = pointerType !== undefined ? pointerType === '' : event.clientX === 0 && event.clientY === 0;
			const rect = node.getBoundingClientRect();
			const rtl = getComputedStyle(node).direction === 'rtl';
			const at: HoldAt = keyed ? { x: rtl ? rect.right - 8 : rect.left + 8, y: rect.bottom, keyboard: true } : { x: event.clientX, y: event.clientY };
			if (onhold(at, node) === false) return;
			event.preventDefault();
			// Android's own long press: the click that ends it is swallowed, as one held here.
			if (pointerType === 'touch') swallow = true;
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
