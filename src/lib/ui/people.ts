import { isSystemId, type Identity } from '$lib/protocol/types';
import { directory } from './directory.svelte';

/** By display name, ignoring case and accents, then by `user_id`, so people who share a name keep one order. */
export function byName(a: Identity, b: Identity): number {
	return directory.name(a).localeCompare(directory.name(b), undefined, { sensitivity: 'base' }) || a.user_id.localeCompare(b.user_id);
}

/** Who you could pick of `users`, such as to talk to or to add to a room: everyone but you and the system identities, by name. */
export function pickable(users: Iterable<Identity>): Identity[] {
	return [...users].filter((user) => !isSystemId(user.user_id) && !directory.isMe(user.user_id)).sort(byName);
}

/** Those of `people` whose name or `user_id` holds what's typed (a leading `@` aside, any case), at most `limit`. */
export function matching(people: readonly Identity[], typed: string, limit: number): Identity[] {
	const wanted = typed.trim().replace(/^@/, '').toLowerCase();
	const found = wanted ? people.filter((user) => directory.name(user).toLowerCase().includes(wanted) || user.user_id.toLowerCase().includes(wanted)) : people;
	return found.slice(0, limit);
}
