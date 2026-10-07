import { dayLabelOf } from './time';

/** How long the day stays floated after the reader stops scrolling. */
const SHOWN_MS = 1200;

/** While you scroll back, the day you're reading floats at the top of the timeline; it fades once you stop. */
export class FloatingDay {
	label = $state('');
	shown = $state(false);
	private timer: ReturnType<typeof setTimeout> | undefined;

	/** Follows a scroll of `scroll`, whose message rows carry `data-message-id` and day dividers `.ap-divider-date`. */
	update(scroll: HTMLElement | undefined, atBottom: boolean): void {
		this.stopTimer();
		if (!scroll || atBottom) {
			this.shown = false;
			return;
		}
		const top = scroll.getBoundingClientRect().top;
		const rows = scroll.querySelectorAll<HTMLElement>('article[data-message-id]');
		const row = firstShowing(rows, top) ?? rows[rows.length - 1];
		const label = row ? dayLabelOf(row.dataset.messageId ?? '') : '';
		// The day's own divider still showing above its first row already says the day; don't float a copy over it.
		const divider = firstShowing(scroll.querySelectorAll<HTMLElement>('.ap-divider-date'), top);
		const dividerShowing = Boolean(row && divider && divider.getBoundingClientRect().top < row.getBoundingClientRect().top);
		this.label = label;
		this.shown = Boolean(label) && !dividerShowing;
		if (this.shown) this.timer = setTimeout(() => (this.shown = false), SHOWN_MS);
	}

	dispose(): void {
		this.stopTimer();
	}

	private stopTimer(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
	}
}

/** The first of `items` still showing below the `top` edge; they're in order, so bisect. */
function firstShowing(items: NodeListOf<HTMLElement>, top: number): HTMLElement | undefined {
	let low = 0;
	let high = items.length;
	while (low < high) {
		const middle = (low + high) >> 1;
		if (items[middle].getBoundingClientRect().bottom <= top) low = middle + 1;
		else high = middle;
	}
	return items[low];
}
