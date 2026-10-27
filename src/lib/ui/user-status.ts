import { PRESENCE_LABELS, presence } from '$lib/design/components/util';
import type { Presence } from '$lib/design/components/types';
import { isPaused, type PausedUntil } from './pause';
import { idDate, idDateTime, idIso, idMillis, idSince } from './time';

/**
 * The statuses you can choose with `me` (§4.5), as the picker lists them:
 * `online` (the default: others see online, idle or offline) and `""`
 * (none) every server takes; `dnd` and `invisible` are optional, offered
 * only where `server.status` lists them (§3.1). A server may still answer
 * another value, which `you` then shows.
 */
export const STATUS_CHOICES = [
	{ value: 'online', label: 'Online', hint: 'Automatic' },
	{ value: 'dnd', label: 'Do not disturb', hint: 'Mutes notifications' },
	{ value: 'invisible', label: 'Invisible', hint: 'Appear offline' },
	{ value: '', label: 'None', hint: 'Show no status' }
] as const;

/** The optional ones (§4.5): a server accepts those `server.status` lists. */
export const OPTIONAL_STATUSES: readonly string[] = ['dnd', 'invisible'];

/**
 * The statuses the picker offers, in `STATUS_CHOICES` order: Online and None
 * always; Do not disturb and Invisible where `server.status` (`accepted`)
 * lists them, until this server answers something else for one
 * (`unsupported`). The `current` status (absent: the default, `online`) stays
 * listed, so it shows as checked.
 */
export function statusChoices(accepted: readonly string[], unsupported: readonly string[], current: string | undefined): Array<(typeof STATUS_CHOICES)[number]> {
	const shown = current ?? 'online';
	const offered = (value: string) => !OPTIONAL_STATUSES.includes(value) || (accepted.includes(value) && !unsupported.includes(value));
	return STATUS_CHOICES.filter((choice) => offered(choice.value) || choice.value === shown);
}

/** A chosen status in words, as the picker names it: "Online", "None", or an unknown value as itself. */
export function chosenStatusLabel(status: string | undefined): string {
	const choice = STATUS_CHOICES.find((entry) => entry.value === (status ?? ''));
	return choice ? choice.label : String(status);
}

/** Your own dot's tooltip: invisible says how others see you. */
export function ownStatusLabel(status: string | undefined): string | undefined {
	return status === 'invisible' ? `${PRESENCE_LABELS.invisible} · others see you as offline` : undefined;
}

/**
 * The `seen` to show for someone (§4.5.2): their kept one, only while their
 * shown status is `offline` (a kept `seen` outlives their coming back
 * online), and never for you, whose status is the one you chose. Undefined
 * otherwise, or when it isn't in the `log_id` format (§2.1): decimal digits
 * of a positive integer below 2^53; nor past the last date a `Date` holds
 * (`idMillis`), which no time can be shown for.
 *
 * `observed` is the local floor: when this client itself received the change
 * of their shown status to `offline` (the client's `sawOffline`), in epoch
 * milliseconds. While they show offline the later of the two shows, so a
 * server that records `seen` coarsely (`SEEN_RECENT_MS`) can't make someone
 * this page watched leave read as gone longer; and it shows alone where no
 * `seen` is kept, since it is this page's own knowledge, not the server's.
 */
export function shownSeen(user: { status?: unknown; seen?: unknown } | undefined, you = false, observed?: number): string | undefined {
	if (you || user?.status !== 'offline') return undefined;
	const seen = user.seen;
	const server = typeof seen === 'string' && /^[1-9][0-9]{0,15}$/.test(seen) && idMillis(seen) !== undefined ? seen : undefined;
	const floor = observed !== undefined && idMillis(String(observed)) !== undefined ? observed : undefined;
	if (floor === undefined) return server;
	return server === undefined || Number(server) < floor ? String(floor) : server;
}

/** How far ahead of `now` a `seen` may be, from a clock that differs a little, and still read as recent. */
export const SEEN_SKEW_MS = 5 * 60 * 1000;

/**
 * Under this long ago, a `seen` reads "recently", with no number of minutes:
 * a server may record `seen` coarsely (one records it to the 10 minutes, and
 * a departure within 10 minutes of the one before keeps the older value), so
 * `4m ago` could be off by as much as it says.
 */
export const SEEN_RECENT_MS = 10 * 60_000;

/** When someone was last seen, for a `<time>`: its words, its `datetime`, and the exact time for its tooltip. */
export interface LastSeen {
	/**
	 * `Last seen recently` under ten minutes ago (`SEEN_RECENT_MS`), then `Last seen 15m ago` (`3h`, `12d` within
	 * two weeks), then the day as the browser's locale writes it, such as `Last seen Sep 14` (with the year when it
	 * isn't this one).
	 */
	text: string;
	/** The time shown, which is the `seen` given (the server's, or the local floor `shownSeen` chose). */
	datetime: string;
	/** `Last seen 2026-10-26 13:20:48`, local time; `Last seen within the last 10 minutes` while the text says recently. */
	title: string;
}

/**
 * A shown `seen` (`shownSeen`) in words, as of `now` (it doesn't tick by
 * itself: read `now` from `minuteNow`). Under `SEEN_RECENT_MS` ago it is
 * "recently", and so is a time a little ahead of `now` (`SEEN_SKEW_MS`),
 * from a clock that differs; its tooltip says within the last ten minutes
 * rather than an exact time the words decline to give. One further ahead
 * says its day, as one past two weeks does: "ago" words for it would be
 * false, and the day is still what the server said, and right if it is this
 * device's clock that is behind. Undefined without one.
 */
export function lastSeen(seen: string | undefined, now = Date.now()): LastSeen | undefined {
	const millis = seen === undefined ? undefined : idMillis(seen);
	const datetime = seen === undefined ? undefined : idIso(seen);
	if (millis === undefined || !datetime) return undefined;
	const ahead = millis - now > SEEN_SKEW_MS;
	if (!ahead && now - millis < SEEN_RECENT_MS) {
		return { text: 'Last seen recently', datetime, title: `Last seen within the last ${SEEN_RECENT_MS / 60_000} minutes` };
	}
	const since = ahead ? idDate(seen!, now) : idSince(seen!, now);
	if (!since) return undefined;
	const words = /^\d+[mhd]$/.test(since) ? `${since} ago` : since;
	return { text: `Last seen ${words}`, datetime, title: `Last seen ${idDateTime(seen!)}` };
}

/** A shown status's words with when they were last seen, for a tooltip: `Offline · last seen 15m ago`, `Offline · last seen recently`. */
export function withLastSeen(label: string | undefined, last: LastSeen | undefined): string | undefined {
	if (!label || !last) return label;
	return `${label} · ${last.text.charAt(0).toLowerCase()}${last.text.slice(1)}`;
}

/**
 * Whether this page stays quiet (no desktop notifications, chime or title
 * flash): your notifications are paused (§4.5 `mute`), or your status is
 * `dnd`, which silences them as `mute` does.
 */
export function pageSilenced(pausedUntil: PausedUntil | undefined, status: unknown, now = Date.now()): boolean {
	return isPaused(pausedUntil, now) || status === 'dnd';
}

const ORDER: Record<Presence, number> = { online: 0, idle: 1, dnd: 2, unknown: 3, offline: 4, invisible: 4 };

/**
 * People in status order: online, idle, do not disturb, unknown, offline
 * (and your own invisible), then those with no status (a server that sends
 * none). Stable: each group keeps the order it came in.
 */
export function byStatus<T>(people: readonly T[], statusOf: (person: T) => string | undefined): T[] {
	const rank = (person: T) => {
		const status = presence(statusOf(person));
		return status === undefined ? 5 : ORDER[status];
	};
	return people.map((person, index) => ({ person, index, rank: rank(person) })).sort((a, b) => a.rank - b.rank || a.index - b.index).map(({ person }) => person);
}
