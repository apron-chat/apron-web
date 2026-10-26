import { PRESENCE_LABELS, presence } from '$lib/design/components/util';
import type { Presence } from '$lib/design/components/types';
import { isPaused, type PausedUntil } from './pause';
import { idDateTime, idIso, idSince } from './time';

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
 * of a positive integer below 2^53.
 */
export function shownSeen(user: { status?: unknown; seen?: unknown } | undefined, you = false): string | undefined {
	if (you || user?.status !== 'offline') return undefined;
	const seen = user.seen;
	return typeof seen === 'string' && /^[1-9][0-9]{0,15}$/.test(seen) && Number.isSafeInteger(Number(seen)) ? seen : undefined;
}

/** When someone was last seen, for a `<time>`: its words, its `datetime`, and the exact time for its tooltip. */
export interface LastSeen {
	/** `Last seen just now`, `Last seen 5m ago` (`3h`, `12d` within two weeks), then `Last seen 14 Sep` (with the year when it isn't this one). */
	text: string;
	datetime: string;
	/** `Last seen 2026-10-26 13:20:48`, local time. */
	title: string;
}

/**
 * A shown `seen` (`shownSeen`) in words, as of `now` (it doesn't tick by
 * itself: read `now` from `minuteNow`). A time ahead of `now`, from a clock
 * that differs, is just now. Undefined without one.
 */
export function lastSeen(seen: string | undefined, now = Date.now()): LastSeen | undefined {
	const since = seen === undefined ? '' : idSince(seen, now);
	const datetime = seen === undefined ? undefined : idIso(seen);
	if (!since || !datetime) return undefined;
	const words = since === 'now' ? 'just now' : /^\d+[mhd]$/.test(since) ? `${since} ago` : since;
	return { text: `Last seen ${words}`, datetime, title: `Last seen ${idDateTime(seen!)}` };
}

/** A shown status's words with when they were last seen, for a tooltip: `Offline · last seen 5m ago`. */
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
