import { PRESENCE_LABELS, presence } from '$lib/design/components/util';
import type { Presence } from '$lib/design/components/types';
import { isPaused, type PausedUntil } from './pause';

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
