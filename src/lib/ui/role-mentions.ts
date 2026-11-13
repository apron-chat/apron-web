import { isMentionableRole, type MentionPerson } from '$lib/protocol/markdown';

/**
 * A role an `@` can name (`@&role`): the people in the room, other than
 * the viewer, who hold it (§3.3.4), in the order the room lists them. Roles
 * are display labels only, so this is the composer's shorthand for picking
 * each of them; the message lists them one by one in `body.mentions` (§3.5.5).
 */
export interface RoleSuggestion {
	role: string;
	members: string[];
	/** Held only by people who aren't in the room (`outsideRoles`): the picker fades it, and its chip mentions them. */
	outside?: boolean;
}

/**
 * The roles held by anyone in `people` but the viewer, each with who holds
 * it, most held first, then by name. A role that can't be written as one ID
 * after `@&` (Appendix A.3), such as one with a space, is left out.
 */
export function roomRoles(people: MentionPerson[]): RoleSuggestion[] {
	const byRole = new Map<string, string[]>();
	for (const person of people) {
		if (person.me || person.outside) continue;
		for (const role of new Set(person.roles ?? [])) {
			if (typeof role !== 'string' || !isMentionableRole(role)) continue;
			const members = byRole.get(role);
			if (members) members.push(person.id);
			else byRole.set(role, [person.id]);
		}
	}
	return [...byRole].map(([role, members]) => ({ role, members })).sort((a, b) => b.members.length - a.members.length || a.role.localeCompare(b.role));
}

/**
 * The roles held only by people who aren't here (`outsiders`, each `outside`), not by anyone in `held`'s roles: each
 * with who holds it, marked `outside`, most held first, then by name. Mentioning one reaches no one unless they're added.
 */
export function outsideRoles(outsiders: MentionPerson[], held: readonly string[]): RoleSuggestion[] {
	const here = new Set(held);
	return roomRoles(outsiders.map((person) => ({ ...person, outside: false })))
		.filter((suggestion) => !here.has(suggestion.role))
		.map((suggestion) => ({ ...suggestion, outside: true }));
}

/**
 * Roles whose name starts with `query` (an `&` before it asks for roles
 * alone), an exact one first. As for people, a space typed after the name
 * matches only the role it names exactly, so `@mo ` lets the picker close.
 */
export function searchRoles(roles: RoleSuggestion[], query: string): RoleSuggestion[] {
	const needle = query.replace(/^&/, '').toLowerCase();
	const exact = needle.trimEnd();
	return roles
		.map((suggestion) => {
			const role = suggestion.role.toLowerCase();
			const rank = exact && role === exact ? 0 : role.startsWith(needle) ? 1 : -1;
			return rank < 0 ? undefined : { suggestion, rank };
		})
		.filter((entry) => entry !== undefined)
		.sort((a, b) => a.rank - b.rank)
		.map((entry) => entry.suggestion);
}
