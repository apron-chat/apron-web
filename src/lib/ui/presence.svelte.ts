import { playPing } from './attention';

/**
 * Whether the viewer is attending this tab, and the alert for a mention that
 * lands while they aren't: a chime, and a tab title that flashes until they're back.
 */
export class PagePresence {
	/** Whether this tab is in front: a hidden tab doesn't read what arrives. */
	visible = $state(typeof document === 'undefined' || document.visibilityState === 'visible');
	/** Whether this window has focus: a mention while it doesn't alerts the tab. */
	focused = $state(typeof document === 'undefined' || document.hasFocus());
	/** Nobody is attending a hidden or unfocused tab (§4.11 `idle`): the server may push instead. */
	away = $derived(!(this.visible && this.focused));
	/** A mention arrived while you were away. */
	attention = $state(false);
	/** Toggles each second while `attention` is up, for the tab title. */
	titleFlash = $state(false);
	private alerted = 0;
	private flashTimer: ReturnType<typeof setInterval> | undefined;

	focus(): void {
		this.focused = true;
		this.setAttention(false);
	}

	blur(): void {
		this.focused = false;
	}

	visibilityChanged(): void {
		this.visible = document.visibilityState === 'visible';
		this.focused = document.hasFocus();
		if (!this.away) this.setAttention(false);
	}

	/** Each mention that lands (by the running count) while you're away flags the tab, and can chime. */
	noteMentions(arrived: number, playSound = true): void {
		if (arrived === this.alerted) return;
		this.alerted = arrived;
		if (!this.away) return;
		this.setAttention(true);
		if (playSound) playPing();
	}

	dispose(): void {
		this.stopFlash();
	}

	private setAttention(on: boolean): void {
		if (this.attention === on) return;
		this.attention = on;
		this.stopFlash();
		this.titleFlash = on;
		if (on) this.flashTimer = setInterval(() => (this.titleFlash = !this.titleFlash), 1000);
	}

	private stopFlash(): void {
		if (this.flashTimer) clearInterval(this.flashTimer);
		this.flashTimer = undefined;
	}
}
