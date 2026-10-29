import type { SidebarPrefs } from './storage';

const KEY_STEP = 16;

/** The panels' widths: each starts at its token's (tokens.css's --sidebar-w, --member-list-w) until you drag it. */
export const ROOMS_LIST_WIDTHS = { defaultWidth: 248, minWidth: 160, maxWidth: 480 };
export const MEMBER_LIST_WIDTHS = { defaultWidth: 240, minWidth: 180, maxWidth: 420 };

export interface SidebarOptions {
	/** The screen edge the panel sits on (mirrored under `dir="rtl"`); its resizable border faces the conversation. */
	side: 'left' | 'right';
	defaultWidth: number;
	minWidth: number;
	maxWidth: number;
	load: () => Partial<SidebarPrefs>;
	save: (prefs: SidebarPrefs) => void;
}

/**
 * Which way along the screen's x axis widens a panel on `side`: toward the
 * conversation, so 1 (rightward) for the rooms list and -1 for the member
 * list, the other way round when `rtl` has mirrored them.
 */
export function outward(side: 'left' | 'right', rtl: boolean): 1 | -1 {
	return (side === 'left') !== rtl ? 1 : -1;
}

/** The arrow key that widens a panel on `side`, the one pointing toward the conversation (see outward). */
export function growKey(side: 'left' | 'right', rtl: boolean): 'ArrowRight' | 'ArrowLeft' {
	return outward(side, rtl) === 1 ? 'ArrowRight' : 'ArrowLeft';
}

/** Whether an element is laid out right to left, as CSS resolves it (`dir="rtl"` on it or an ancestor). */
function isRtl(element: Element): boolean {
	return getComputedStyle(element).direction === 'rtl';
}

/**
 * A side panel's width, user-resizable by dragging its inner border (the
 * rooms list's right one, the member list's left one, mirrored under
 * `dir="rtl"`); a plain click on the border collapses or expands it, and
 * dragging it under half the minimum width collapses it.
 */
export class SidebarLayout {
	width = $state(0);
	collapsed = $state(false);
	resizing = $state(false);

	constructor(private readonly options: SidebarOptions) {
		this.width = options.defaultWidth;
	}

	get side(): 'left' | 'right' {
		return this.options.side;
	}

	load(): void {
		const saved = this.options.load();
		if (saved.width !== undefined) this.width = this.clamp(saved.width);
		if (saved.collapsed !== undefined) this.collapsed = saved.collapsed;
	}

	toggle(): void {
		this.collapsed = !this.collapsed;
		this.save();
	}

	/** A press on the border: a drag toward the conversation widens the panel; `rtl` is the handle's direction unless given. */
	startResize(event: PointerEvent, rtl?: boolean): void {
		if (event.button !== 0) return;
		event.preventDefault();
		const handle = event.currentTarget as HTMLElement;
		const startX = event.clientX;
		const startWidth = this.collapsed ? 0 : this.width;
		const restoreWidth = this.width;
		// A right-hand panel (the member list, or under rtl the rooms list) grows as its border is dragged left.
		const direction = outward(this.options.side, rtl ?? isRtl(handle));
		let moved = false;
		handle.setPointerCapture(event.pointerId);
		this.resizing = true;
		const onMove = (e: PointerEvent) => {
			const dx = (e.clientX - startX) * direction;
			if (!moved && Math.abs(dx) < 4) return;
			moved = true;
			const next = startWidth + dx;
			if (next < this.options.minWidth / 2) {
				this.collapsed = true;
			} else {
				this.collapsed = false;
				this.width = this.clamp(next);
			}
		};
		const onUp = () => {
			handle.removeEventListener('pointermove', onMove);
			handle.removeEventListener('pointerup', onUp);
			handle.removeEventListener('pointercancel', onUp);
			handle.releasePointerCapture(event.pointerId);
			this.resizing = false;
			if (!moved) this.collapsed = !this.collapsed;
			// Dragged shut: reopening brings back the width it had, not the minimum it passed through.
			else if (this.collapsed) this.width = restoreWidth;
			this.save();
		};
		handle.addEventListener('pointermove', onMove);
		handle.addEventListener('pointerup', onUp);
		handle.addEventListener('pointercancel', onUp);
	}

	/**
	 * Arrows move the border the way they point (toward the conversation grows, mirrored under rtl, which `rtl` gives
	 * unless the handle's direction does); Enter and Space toggle through the handle's native click.
	 */
	handleKey(event: KeyboardEvent, rtl?: boolean): void {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		event.preventDefault();
		const grow = event.key === growKey(this.options.side, rtl ?? isRtl(event.currentTarget as Element));
		if (this.collapsed) {
			if (grow) this.collapsed = false;
		} else {
			this.width = this.clamp(this.width + (grow ? KEY_STEP : -KEY_STEP));
		}
		this.save();
	}

	private save(): void {
		this.options.save({ width: this.width, collapsed: this.collapsed });
	}

	private clamp(width: number): number {
		return Math.min(this.options.maxWidth, Math.max(this.options.minWidth, Math.round(width)));
	}
}
