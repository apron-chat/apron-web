import type { ChatClient } from '$lib/protocol/client';
import { isMentionableRole } from '$lib/protocol/markdown';
import type { Identity } from '$lib/protocol/types';

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

/**
 * Whether `user` looks like a guest, which the protocol doesn't say outright: a `user_id` by the suggested convention
 * for guest sign-in, `guest_` and a counter (§3.2), or a `guest` label in `roles`, which some servers give though §3.3
 * names none. A guest who never signs in to an account keeps their `user_id` only as long as their session, and a
 * server may not let guests be added at all, so they aren't offered to add. A heuristic: a server that names lasting
 * accounts `guest_…` has them left out too.
 */
export function isGuest(user: Identity): boolean {
	return user.user_id.startsWith('guest_') || (Array.isArray(user.roles) && user.roles.includes('guest'));
}

/**
 * Who of `mentions` (a draft's `body.mentions`, §3.5) isn't a member of `room`, once each, in the order mentioned, but
 * those `skip` names (such as you, the system identities and guests). None while the members aren't all known: before
 * any listing, or when the server listed only some of them (`memberCount`, §4.2.1), since then anyone could be one.
 */
export function absentMentions(mentions: readonly string[], room: { members?: readonly Identity[]; memberCount?: number }, skip: (userId: string) => boolean): string[] {
	const members = room.members;
	if (!members || (room.memberCount !== undefined && room.memberCount > members.length)) return [];
	const memberIds = new Set(members.map((member) => member.user_id));
	return [...new Set(mentions)].filter((userId) => !memberIds.has(userId) && !skip(userId));
}

/**
 * Who to ask to add for the roles a message mentions: a role mentions those here who hold it (its chip names them), so
 * one that someone here besides you holds asks about no one. A role no one else here holds would mention no one: it
 * asks about everyone in `users` (those the session knows) who holds it, in the order `users` lists them.
 */
export function unheldRoleHolders(roles: readonly string[], users: readonly Identity[], memberIds: ReadonlySet<string>, isMe: (userId: string) => boolean): string[] {
	const holds = (user: Identity, role: string) => Array.isArray(user.roles) && user.roles.includes(role);
	const ids = roles.flatMap((role) => {
		const holders = users.filter((user) => holds(user, role));
		return holders.some((user) => memberIds.has(user.user_id) && !isMe(user.user_id)) ? [] : holders.map((user) => user.user_id);
	});
	return [...new Set(ids)];
}

/** Everyone with a role, to add together: `@mod` adds each of them. */
export interface RoleSet {
	role: string;
	/** Their `user_id`s, in the order the people came in. */
	userIds: string[];
}

/**
 * The roles held by `people` that `typed` starts to name, as a mention does: after an `@` (or `@&`, or `&`), in any
 * case. Each comes with who holds it: one named exactly first, then by how many hold it, then by name; at most
 * `limit`. A plain name names no role, so typing someone's name lists people alone. A role that can't be written
 * `@&role` (Appendix A.3), such as one with a space, is left out, as the composer leaves it.
 */
export function roleSets(people: readonly Identity[], typed: string, limit: number): RoleSet[] {
	const mention = /^(?:@&?|&)(.+)$/.exec(typed.trim());
	if (!mention) return [];
	const wanted = mention[1].toLowerCase();
	const byRole = new Map<string, string[]>();
	for (const person of people) {
		for (const role of new Set(Array.isArray(person.roles) ? person.roles : [])) {
			if (typeof role !== 'string' || !isMentionableRole(role) || !role.toLowerCase().startsWith(wanted)) continue;
			const userIds = byRole.get(role);
			if (userIds) userIds.push(person.user_id);
			else byRole.set(role, [person.user_id]);
		}
	}
	const rank = (role: string) => (role.toLowerCase() === wanted ? 0 : 1);
	return [...byRole]
		.map(([role, userIds]) => ({ role, userIds }))
		.sort((a, b) => rank(a.role) - rank(b.role) || b.userIds.length - a.userIds.length || a.role.localeCompare(b.role))
		.slice(0, limit);
}

/** A section of the member list: everyone online, or everyone offline. */
export interface MemberSection<T> {
	key: 'online' | 'offline' | 'members';
	label: string;
	people: T[];
}

/**
 * Members in sections, as Discord lists them: Online, then Offline (§4.5
 * `offline`, or your own `invisible`). A member with no status isn't known
 * to be offline, so stays with the online ones. Without presence (a server
 * without capability `status`, or no member with a status), there is no
 * online or offline: everyone is in one Members section. Each section keeps
 * the order the people came in, and an empty one is left out.
 */
export function memberSections<T>(people: readonly T[], statusOf: (person: T) => string | undefined, presence = true): MemberSection<T>[] {
	if (!presence || !people.some((person) => Boolean(statusOf(person)))) return people.length ? [{ key: 'members', label: 'Members', people: [...people] }] : [];
	const offline = (person: T) => statusOf(person) === 'offline' || statusOf(person) === 'invisible';
	const sections: MemberSection<T>[] = [
		{ key: 'online', label: 'Online', people: people.filter((person) => !offline(person)) },
		{ key: 'offline', label: 'Offline', people: people.filter(offline) }
	];
	return sections.filter((section) => section.people.length);
}

/** Someone who couldn't be added to a room, with the server's words why. */
export interface Refusal {
	userId: string;
	message: string;
}

/**
 * Adds each of `userIds` to the room in turn (`room_join` with their `user_id`, §4.2.2). Who may add whom is server
 * policy: one it refuses doesn't stop the rest, and comes back with why.
 */
export async function addMembers(client: Pick<ChatClient, 'joinRoom'>, roomId: string, userIds: readonly string[]): Promise<Refusal[]> {
	const refused: Refusal[] = [];
	for (const userId of userIds) {
		try {
			await client.joinRoom(roomId, userId).promise;
		} catch (cause) {
			refused.push({ userId, message: cause instanceof Error ? cause.message : 'Unable to add them' });
		}
	}
	return refused;
}

/** Who couldn't be added, by name, and the server's words why: "Couldn’t add Carol: …". */
export function couldNotAdd(refused: readonly Refusal[], nameOf: (userId: string) => string): string {
	return refused.map(({ userId, message }) => `Couldn’t add ${nameOf(userId)}: ${message.replace(/[.\s]+$/, '')}.`).join(' ');
}
