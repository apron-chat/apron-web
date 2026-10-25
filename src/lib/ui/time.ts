import type { MessageRecord } from '$lib/protocol/types';

/** Consecutive messages from one sender within this window read as one group. */
export const GROUP_WINDOW_MS = 5 * 60 * 1000;

/** Log IDs (and so message IDs, the creation `log_id`) are epoch milliseconds (§2); anything else has no time. */
export function idMillis(id: string): number | undefined {
	const millis = Number(id);
	return Number.isSafeInteger(millis) && millis > 0 ? millis : undefined;
}

function eventMillis(event: MessageRecord): number | undefined {
	return idMillis(event.message_id);
}

// Formats follow the browser's locale and its 12/24-hour preference.
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const dayYearFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const dateYearFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** How far back `idSince` counts in `idAgo`'s units before it names the day. */
export const SINCE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** The local time of day, `2:02 PM` or `14:02` as the browser prefers, or empty when the ID carries no time. */
export function eventTime(event: MessageRecord): string {
	return idTime(event.message_id);
}

/** The local time of day a log ID falls at, or empty when it carries no time. */
export function idTime(id: string): string {
	const millis = idMillis(id);
	return millis ? timeFormat.format(millis) : '';
}

/** The time of day without AM/PM (`2:02`), for the narrow hover time beside grouped messages. */
export function idTimeCompact(id: string): string {
	const millis = idMillis(id);
	if (!millis) return '';
	return timeFormat.formatToParts(millis).filter((part) => part.type !== 'dayPeriod').map((part) => part.value).join('').trim();
}

/**
 * How long ago a log ID was, as compactly as a narrow row allows: `now`, `5m`,
 * `3h`, `4d`, `9w`, then `2y`. Empty when the ID carries no time. It is as of
 * `now` and doesn't tick by itself.
 */
export function idAgo(id: string, now = Date.now()): string {
	const millis = idMillis(id);
	if (!millis) return '';
	const minutes = Math.floor((now - millis) / 60_000);
	if (minutes < 1) return 'now';
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d`;
	const weeks = Math.floor(days / 7);
	if (weeks < 52) return `${weeks}w`;
	return `${Math.floor(days / 365) || 1}y`;
}

/**
 * When a log ID was, for a thread's last reply: `now`, `12m`, `9h`, `12d`
 * within two weeks, then the day, `14 Sep` (with the year when it
 * isn't this one). Empty when the ID carries no time; as of `now`, like `idAgo`.
 */
export function idSince(id: string, now = Date.now()): string {
	const millis = idMillis(id);
	if (!millis) return '';
	const elapsed = now - millis;
	if (elapsed < SINCE_WINDOW_MS) {
		// Days stay days (`12d`) here, where idAgo turns a week into `1w`.
		return elapsed < 24 * 60 * 60 * 1000 ? idAgo(id, now) : `${Math.floor(elapsed / (24 * 60 * 60 * 1000))}d`;
	}
	return (new Date(millis).getFullYear() === new Date(now).getFullYear() ? dateFormat : dateYearFormat).format(millis);
}

/** The exact local date and time, `YYYY-MM-DD HH:MM:SS`, for a timestamp's tooltip. */
export function idDateTime(id: string): string {
	const millis = idMillis(id);
	if (!millis) return '';
	const date = new Date(millis);
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** A `<time datetime>` value, or undefined when the ID carries no time. */
export function idIso(id: string): string | undefined {
	const millis = idMillis(id);
	return millis ? new Date(millis).toISOString() : undefined;
}

export function dayKey(event: MessageRecord): string {
	return dayKeyOf(event.message_id);
}

/** The local day a log ID falls on, or empty when it carries no time. */
export function dayKeyOf(id: string): string {
	const millis = idMillis(id);
	if (!millis) return '';
	const date = new Date(millis);
	return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** "Today", "Yesterday", then `Mon 14 Sep`, as the date dividers read. */
export function dayLabel(event: MessageRecord, now = new Date()): string {
	return dayLabelOf(event.message_id, now);
}

export function dayLabelOf(id: string, now = new Date()): string {
	const millis = idMillis(id);
	if (!millis) return '';
	const date = new Date(millis);
	const yesterday = new Date(now);
	yesterday.setDate(now.getDate() - 1);
	if (sameDay(date, now)) return 'Today';
	if (sameDay(date, yesterday)) return 'Yesterday';
	return (date.getFullYear() === now.getFullYear() ? dayFormat : dayYearFormat).format(date);
}

/** When a quoted message was: the time of day today, else with its day before it (`Yesterday 2:05 PM`, `Mon 14 Sep 2:05 PM`). */
export function idWhen(id: string, now = new Date()): string {
	const time = idTime(id);
	if (!time || dayKeyOf(id) === dayKeyOf(String(now.getTime()))) return time;
	return `${dayLabelOf(id, now)} ${time}`;
}

function sameDay(a: Date, b: Date): boolean {
	return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * A follower in a group: same sender as the previous message, within the
 * window. A reply never is: its quote sits above the sender's name, its spine
 * leading into their avatar.
 */
export function isGrouped(previous: MessageRecord | undefined, event: MessageRecord): boolean {
	if (event.reply_to && !event.deleted) return false;
	if (!previous || !previous.from?.user_id || previous.from.user_id !== event.from?.user_id) return false;
	const before = eventMillis(previous);
	const after = eventMillis(event);
	return before !== undefined && after !== undefined && after - before < GROUP_WINDOW_MS;
}


/** `0:12`: the running time of a voice recording. */
export function clockLabel(seconds: number): string {
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
