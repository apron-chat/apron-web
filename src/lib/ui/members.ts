/**
 * The `user_id` typed to add someone to a room (§4.2.2): exactly that ID,
 * written bare or as `@user_id`. Display names are never looked up, since
 * they aren't unique (§3.3): adding by name could add an impersonator.
 * Undefined when the text can't be an ID: a `user_id` is never empty, and
 * has no whitespace or control characters (§2.4).
 */
export function userIdToAdd(typed: string): string | undefined {
	const id = typed.trim().replace(/^@/, '');
	return id && !/[\s\p{Cc}]/u.test(id) ? id : undefined;
}

/** A section of the member list: a role's online members, everyone else online, or everyone offline. */
export interface MemberSection<T> {
	key: string;
	/** The role as written (§3.3.4), for a role's section. */
	role?: string;
	label: string;
	people: T[];
}

/** Roles with a conventional rank lead, in this order; `bot` comes last, and any other role by name between. */
const LEADING_ROLES = ['admin', 'mod', 'moderator'];
const TRAILING_ROLES = ['bot'];

/** How roles' sections are ordered: no role outranks another in the protocol (§3.3.4), so by convention, then by name. */
export function compareRoles(a: string, b: string): number {
	const rank = (role: string) => {
		const lead = LEADING_ROLES.indexOf(role);
		if (lead >= 0) return lead;
		return TRAILING_ROLES.includes(role) ? LEADING_ROLES.length + 1 : LEADING_ROLES.length;
	};
	return rank(a) - rank(b) || a.localeCompare(b, undefined, { sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * Members in sections, as Discord lists them: each role's online members
 * under that role (one with several under the first in role order), then
 * the rest online, then everyone offline (§4.5 `offline`, or your own
 * `invisible`), whatever their roles. A member with no status isn't known
 * to be offline, so stays with the online ones. Without presence (a server
 * without capability `status`, or no member with a status), there is no
 * online or offline: each role's members, then the rest as Members. Each
 * section keeps the order the people came in.
 */
export function memberSections<T>(people: readonly T[], statusOf: (person: T) => string | undefined, rolesOf: (person: T) => readonly string[], presence = true): MemberSection<T>[] {
	const split = presence && people.some((person) => Boolean(statusOf(person)));
	const roles = new Map<string, T[]>();
	const online: T[] = [];
	const offline: T[] = [];
	for (const person of people) {
		const status = split ? statusOf(person) : undefined;
		if (status === 'offline' || status === 'invisible') {
			offline.push(person);
			continue;
		}
		const role = [...rolesOf(person)].sort(compareRoles)[0];
		if (role === undefined) online.push(person);
		else roles.set(role, [...(roles.get(role) ?? []), person]);
	}
	const sections: MemberSection<T>[] = [...roles].sort(([a], [b]) => compareRoles(a, b)).map(([role, people]) => ({ key: `role:${role}`, role, label: role, people }));
	if (online.length) sections.push({ key: 'online', label: split ? 'Online' : 'Members', people: online });
	if (offline.length) sections.push({ key: 'offline', label: 'Offline', people: offline });
	return sections;
}
