/**
 * Pausing notifications (§4.11 `status` `mute`): for a while, or until
 * resumed. The client keeps when the pause ends, as epoch milliseconds or
 * `true` (until resumed), and sends `mute` as the seconds left or `true`.
 */
export type PausedUntil = number | true;

/** A way to pause, as the Pause menu lists it. */
export interface PauseChoice {
	value: string;
	label: string;
	/** When it ends, such as "until 15:42". */
	hint?: string;
	until: PausedUntil;
}

/** The hour "until tomorrow" ends at. */
const MORNING_HOUR = 9;

function clock(at: Date): string {
	return at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** The Pause menu: an hour, eight hours, until tomorrow morning, or until resumed. */
export function pauseChoices(now = new Date()): PauseChoice[] {
	const hour = new Date(now.getTime() + 60 * 60 * 1000);
	const eight = new Date(now.getTime() + 8 * 60 * 60 * 1000);
	const morning = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, MORNING_HOUR);
	return [
		{ value: '1h', label: 'For 1 hour', hint: `until ${clock(hour)}`, until: hour.getTime() },
		{ value: '8h', label: 'For 8 hours', hint: `until ${clock(eight)}`, until: eight.getTime() },
		{ value: 'tomorrow', label: 'Until tomorrow', hint: clock(morning), until: morning.getTime() },
		{ value: 'resume', label: 'Until I resume', until: true }
	];
}

/** The `mute` to send for a pause: seconds left (at least 1), or `true`. */
export function muteFor(until: PausedUntil, now = Date.now()): number | true {
	return until === true ? true : Math.max(1, Math.ceil((until - now) / 1000));
}

/** Whether notifications are paused now. */
export function isPaused(until: PausedUntil | undefined, now = Date.now()): boolean {
	return until === true || (until !== undefined && until > now);
}

/** When a pause ends, in words: "until 14:30", "until tomorrow 9:00", "until Fri 9:00", or "until you resume". */
export function pausedUntilLabel(until: PausedUntil, now = new Date()): string {
	if (until === true) return 'until you resume';
	const at = new Date(until);
	const days = Math.round((new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000);
	if (days <= 0) return `until ${clock(at)}`;
	if (days === 1) return `until tomorrow ${clock(at)}`;
	return `until ${at.toLocaleDateString([], { weekday: 'short' })} ${clock(at)}`;
}
