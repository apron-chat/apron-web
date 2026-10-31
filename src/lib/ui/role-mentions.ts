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
}

/**
 * The roles held by anyone in `people` but the viewer, each with who holds
 * it, most held first, then by name. A role that can't be written as one ID
 * after `@&` (Appendix A.3), such as one with a space, is left out.
 */
export function roomRoles(people: MentionPerson[]): RoleSuggestion[] {
	const byRole = new Map<string, string[]>();
	for (const person of people) {
		if (person.me) continue;
		for (const role of new Set(person.roles ?? [])) {
			if (typeof role !== 'string' || !isMentionableRole(role)) continue;
			const members = byRole.get(role);
			if (members) members.push(person.id);
			else byRole.set(role, [person.id]);
		}
	}
	return [...byRole].map(([role, members]) => ({ role, members })).sort((a, b) => b.members.length - a.members.length || a.role.localeCompare(b.role));
}

/** Roles whose name starts with `query` (an `&` before it asks for roles alone), an exact one first. */
export function searchRoles(roles: RoleSuggestion[], query: string): RoleSuggestion[] {
	const needle = query.replace(/^&/, '').trimEnd().toLowerCase();
	return roles
		.map((suggestion) => {
			const role = suggestion.role.toLowerCase();
			const rank = role === needle ? 0 : role.startsWith(needle) ? 1 : -1;
			return rank < 0 ? undefined : { suggestion, rank };
		})
		.filter((entry) => entry !== undefined)
		.sort((a, b) => a.rank - b.rank)
		.map((entry) => entry.suggestion);
}
