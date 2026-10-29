/** How far the pointer moves before a press becomes a drag, so a click stays a click. */
const THRESHOLD = 4;
/** Within this far of the scroller's top or bottom, a drag scrolls it, a step each frame. */
const EDGE = 32;
const SCROLL_STEP = 8;

/** Where a dragged row would land: just before or after another. */
export type Drop = { target: string; side: 'before' | 'after' };

interface ListDragOptions {
	/** What a drag starts from within a row: its main button. */
	handle: string;
	/** A row dropped somewhere other than where it was. */
	onmove: (id: string, drop: Drop) => void;
	/** The scrolling element the list is in, scrolled while the pointer is near its edges. */
	scroller?: () => HTMLElement | null | undefined;
}

/**
 * Dragging a row to another place in its list, with a mouse or pen: touch is left to scroll, so phones reorder from a
 * menu instead. The rows are the list element's children with `data-drag-id`, and the list takes `press` as its
 * `pointerdown`. A press that moves less than `THRESHOLD` stays a click; one that becomes a drag doesn't pick the row
 * it began on. Escape puts it back.
 */
export class ListDrag {
	/** The row being dragged, once the pointer has moved. */
	dragging = $state<string>();
	/** Where it would land; none while that's where it already is. */
	drop = $state<Drop>();

	constructor(private readonly options: ListDragOptions) {}

	press(event: PointerEvent): void {
		if (event.button !== 0 || event.pointerType === 'touch' || this.dragging !== undefined) return;
		const list = event.currentTarget as HTMLElement;
		const row = (event.target as Element).closest(this.options.handle)?.closest<HTMLElement>('[data-drag-id]');
		if (!row || row.parentElement !== list) return;
		const id = row.dataset.dragId!;
		const { pointerId, clientY: startY } = event;
		let y = startY;
		let frame = 0;
		const scroll = () => {
			const scroller = this.options.scroller?.();
			if (scroller) {
				const box = scroller.getBoundingClientRect();
				const by = y < box.top + EDGE ? -SCROLL_STEP : y > box.bottom - EDGE ? SCROLL_STEP : 0;
				if (by) {
					scroller.scrollTop += by;
					this.drop = this.dropAt(list, id, y);
				}
			}
			frame = requestAnimationFrame(scroll);
		};
		const move = (e: PointerEvent) => {
			if (e.pointerId !== pointerId) return;
			y = e.clientY;
			if (this.dragging === undefined) {
				if (Math.abs(y - startY) < THRESHOLD) return;
				this.dragging = id;
				list.setPointerCapture(pointerId);
				getSelection()?.removeAllRanges();
				frame = requestAnimationFrame(scroll);
			}
			this.drop = this.dropAt(list, id, y);
		};
		const finish = (commit: boolean) => {
			removeEventListener('pointermove', move);
			removeEventListener('pointerup', up);
			removeEventListener('pointercancel', cancel);
			removeEventListener('keydown', key, true);
			cancelAnimationFrame(frame);
			if (this.dragging !== undefined) {
				if (list.hasPointerCapture(pointerId)) list.releasePointerCapture(pointerId);
				// The press ends in a click on the row it began on; a drag isn't a pick.
				const swallow = (e: Event) => {
					e.stopPropagation();
					e.preventDefault();
				};
				addEventListener('click', swallow, { capture: true, once: true });
				setTimeout(() => removeEventListener('click', swallow, { capture: true }));
				if (commit && this.drop) this.options.onmove(id, this.drop);
			}
			this.dragging = undefined;
			this.drop = undefined;
		};
		const up = (e: PointerEvent) => {
			if (e.pointerId === pointerId) finish(true);
		};
		const cancel = (e: PointerEvent) => {
			if (e.pointerId === pointerId) finish(false);
		};
		const key = (e: KeyboardEvent) => {
			if (e.key !== 'Escape' || this.dragging === undefined) return;
			e.preventDefault();
			e.stopPropagation();
			finish(false);
		};
		addEventListener('pointermove', move);
		addEventListener('pointerup', up);
		addEventListener('pointercancel', cancel);
		addEventListener('keydown', key, true);
	}

	/**
	 * Where `id` would land with the pointer at `y`: before the first row whose handle's middle is below it, else after
	 * the last. None where that's where it already is.
	 */
	private dropAt(list: HTMLElement, id: string, y: number): Drop | undefined {
		const rows = [...list.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child.dataset.dragId !== undefined);
		const ids = rows.map((row) => row.dataset.dragId!);
		const over = rows.find((row) => {
			const box = (row.querySelector(this.options.handle) ?? row).getBoundingClientRect();
			return y < box.top + box.height / 2;
		});
		const drop: Drop | undefined = over ? { target: over.dataset.dragId!, side: 'before' } : ids.length ? { target: ids[ids.length - 1], side: 'after' } : undefined;
		const at = ids.indexOf(id);
		if (!drop || drop.target === id || (drop.side === 'before' && ids[at + 1] === drop.target) || (drop.side === 'after' && ids[at - 1] === drop.target)) return undefined;
		return drop;
	}
}
