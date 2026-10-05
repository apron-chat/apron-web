import { PRESENCE_LABELS, presence } from '$lib/design/components/util';
import type { Presence } from '$lib/design/components/types';
import { pausedUntilLabel, type PausedUntil } from './pause';

/**
 * Your own `status` (§4.11, `you` ignores `invisible`): what `you` last said,
 * shown as `dnd` at once while your notifications are paused, ahead of the
 * server's echo. Only where the server sends a `status` at all: a server
 * that sends none (or cleared it with `""`, §3.3) shows no status, paused
 * or not.
 */
export function ownStatus(status: unknown, pausedUntil: PausedUntil | undefined): Presence | undefined {
	if (typeof status !== 'string' || status === '') return undefined;
	return pausedUntil !== undefined ? 'dnd' : presence(status);
}

/** Your status in words for its tooltip: while paused, when that ends ("Do not disturb · until 14:30"). */
export function ownStatusLabel(status: Presence | undefined, pausedUntil: PausedUntil | undefined, now = new Date()): string | undefined {
	if (!status) return undefined;
	return status === 'dnd' && pausedUntil !== undefined ? `${PRESENCE_LABELS.dnd} · ${pausedUntilLabel(pausedUntil, now)}` : PRESENCE_LABELS[status];
}

const ORDER: Record<Presence, number> = { online: 0, idle: 1, dnd: 2, offline: 3 };

/**
 * People in status order: online, idle, do not disturb, offline, then those
 * with no status (a server that sends none). Stable: each group keeps the
 * order it came in.
 */
export function byStatus<T>(people: readonly T[], statusOf: (person: T) => Presence | undefined): T[] {
	const rank = (person: T) => {
		const status = statusOf(person);
		return status === undefined ? 4 : ORDER[status];
	};
	return people.map((person, index) => ({ person, index, rank: rank(person) })).sort((a, b) => a.rank - b.rank || a.index - b.index).map(({ person }) => person);
}
