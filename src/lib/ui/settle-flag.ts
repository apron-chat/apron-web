/** How long something has to keep going before it's shown at all, in milliseconds. */
export const SHOW_AFTER_MS = 400;
/** How long it stays once shown, at least, so it never just blinks, in milliseconds. */
export const MIN_SHOWN_MS = 600;
/** How long it stays after the work ends, so work that comes in steps (recovering, then listing) reads as one. */
export const LINGER_MS = 300;

/**
 * A flag for an indicator of something usually quick, such as checking for new
 * messages: it turns on only once the source has stayed on for `showAfter`, and
 * once on, stays on for at least `minShown`, and for `linger` after the source
 * last turned off. Quick work then shows nothing, and slow work, also in steps,
 * never flickers.
 */
export class SettleFlag {
	private on = false;
	private shownAt = 0;
	private showTimer: ReturnType<typeof setTimeout> | undefined;
	private hideTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly onchange: (on: boolean) => void,
		private readonly showAfter = SHOW_AFTER_MS,
		private readonly minShown = MIN_SHOWN_MS,
		private readonly linger = LINGER_MS
	) {}

	set(source: boolean): void {
		if (source) {
			clearTimeout(this.hideTimer);
			this.hideTimer = undefined;
			if (this.on || this.showTimer) return;
			this.showTimer = setTimeout(() => {
				this.showTimer = undefined;
				this.on = true;
				this.shownAt = Date.now();
				this.onchange(true);
			}, this.showAfter);
			return;
		}
		clearTimeout(this.showTimer);
		this.showTimer = undefined;
		if (!this.on || this.hideTimer) return;
		const left = Math.max(this.linger, this.minShown - (Date.now() - this.shownAt));
		if (left <= 0) this.hide();
		else this.hideTimer = setTimeout(() => this.hide(), left);
	}

	private hide(): void {
		this.hideTimer = undefined;
		this.on = false;
		this.onchange(false);
	}

	dispose(): void {
		clearTimeout(this.showTimer);
		clearTimeout(this.hideTimer);
		this.showTimer = this.hideTimer = undefined;
	}
}
