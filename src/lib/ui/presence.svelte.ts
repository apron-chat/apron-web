import { playPing } from './attention';

/**
 * How long a page goes without input before nobody is taken to be attending
 * it (§4.5 `idle`), as chat apps do: Discord and Teams wait about five
 * minutes, Slack ten. Losing focus alone doesn't start it: a window on
 * another monitor is still read.
 */
export const IDLE_AFTER_MS = 5 * 60_000;

/** Input closer together than this doesn't restart the wait: pointer moves come many a second. */
const INPUT_THROTTLE_MS = 1_000;

/**
 * A phone or tablet, where a hidden page is an app in the background,
 * which the system may suspend at any moment, as mobile chat apps take it.
 */
function handheld(): boolean {
	return typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;
}

/**
 * Whether the viewer is attending this tab, and the alert for a mention that
 * lands while they aren't: a chime, and a tab title that flashes until they're back.
 */
export class PagePresence {
	/** Whether this tab is in front: a hidden tab doesn't read what arrives. */
	visible = $state(typeof document === 'undefined' || document.visibilityState === 'visible');
	/** Whether this window has focus: a mention while it doesn't alerts the tab. */
	focused = $state(typeof document === 'undefined' || document.hasFocus());
	/** Not looking at this tab, hidden or unfocused: a mention alerts it. */
	away = $derived(!(this.visible && this.focused));
	/**
	 * Nobody is attending this page (§4.5 `idle`): the server may push
	 * instead. No input for IDLE_AFTER_MS, hidden on a handheld, or loaded
	 * hidden and not used since; any input ends it.
	 */
	idle = $state(typeof document !== 'undefined' && document.visibilityState === 'hidden');
	/** A mention arrived while you were away. */
	attention = $state(false);
	/** Toggles each second while `attention` is up, for the tab title. */
	titleFlash = $state(false);
	private alerted = 0;
	private flashTimer: ReturnType<typeof setInterval> | undefined;
	private idleTimer: ReturnType<typeof setTimeout> | undefined;
	private inputAt = Number.NEGATIVE_INFINITY;
	private readonly handheld: boolean;

	constructor(options: { handheld?: boolean } = {}) {
		this.handheld = options.handheld ?? handheld();
		if (!this.idle && typeof document !== 'undefined') this.waitForIdle();
	}

	focus(): void {
		this.focused = true;
		this.setAttention(false);
		this.input();
	}

	blur(): void {
		this.focused = false;
	}

	visibilityChanged(): void {
		this.visible = document.visibilityState === 'visible';
		this.focused = document.hasFocus();
		if (!this.away) this.setAttention(false);
		if (this.visible) this.input();
		else if (this.handheld) this.becomeIdle();
	}

	/**
	 * Someone used this page: a key, a click or tap, a pointer move or a
	 * scroll. It ends `idle` at once and restarts the wait. A key or a press
	 * also means this window has focus, whatever its events said.
	 */
	input(pressed = false): void {
		if (pressed && !this.focused) {
			this.focused = true;
			if (!this.away) this.setAttention(false);
		}
		const now = Date.now();
		if (!this.idle && now - this.inputAt < INPUT_THROTTLE_MS) return;
		this.inputAt = now;
		this.idle = false;
		this.waitForIdle();
	}

	/**
	 * Each mention that lands (by the running count) while you're away flags
	 * the tab, and can chime. While `silenced` (paused, or do not disturb,
	 * §4.5) it is counted and nothing else: it doesn't alert later either.
	 */
	noteMentions(arrived: number, playSound = true, silenced = false): void {
		if (arrived === this.alerted) return;
		this.alerted = arrived;
		if (silenced || !this.away) return;
		this.setAttention(true);
		if (playSound) playPing();
	}

	dispose(): void {
		this.stopFlash();
		this.clearIdleTimer();
	}

	private waitForIdle(): void {
		this.clearIdleTimer();
		this.idleTimer = setTimeout(() => this.becomeIdle(), IDLE_AFTER_MS);
	}

	private becomeIdle(): void {
		this.clearIdleTimer();
		this.idle = true;
	}

	private clearIdleTimer(): void {
		if (this.idleTimer) clearTimeout(this.idleTimer);
		this.idleTimer = undefined;
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
