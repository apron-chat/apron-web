import { dayLabelOf } from './time';

/** How long the day stays floated after the reader stops scrolling. */
const SHOWN_MS = 1200;

/** While you scroll back, the day you're reading floats at the top of the timeline; it fades once you stop. */
export class FloatingDay {
	label = $state('');
	shown = $state(false);
	private timer: ReturnType<typeof setTimeout> | undefined;

	/** Follows a scroll of `scroll`, whose message rows carry `data-message-id`. */
	update(scroll: HTMLElement | undefined, atBottom: boolean): void {
		this.stopTimer();
		if (!scroll || atBottom) {
			this.shown = false;
			return;
		}
		// The first message still showing below the top edge; rows are in order, so bisect.
		const top = scroll.getBoundingClientRect().top;
		const rows = scroll.querySelectorAll<HTMLElement>('article[data-message-id]');
		let low = 0;
		let high = rows.length - 1;
		while (low < high) {
			const middle = (low + high) >> 1;
			if (rows[middle].getBoundingClientRect().bottom <= top) low = middle + 1;
			else high = middle;
		}
		const label = rows.length ? dayLabelOf(rows[low].dataset.messageId ?? '') : '';
		this.label = label;
		this.shown = Boolean(label);
		this.timer = setTimeout(() => (this.shown = false), SHOWN_MS);
	}

	dispose(): void {
		this.stopTimer();
	}

	private stopTimer(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
	}
}
