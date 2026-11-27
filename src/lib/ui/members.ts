import type { ChatClient } from '$lib/protocol/client';
import { isMentionableRole, type MentionPerson } from '$lib/protocol/markdown';
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
 * The IDs of `members` while they're all known, as `absentMentions` needs them: undefined before any listing, or when
 * the server listed only some (`memberCount`), since then anyone could be one.
 */
export function knownMemberIds(members: readonly Identity[] | undefined, memberCount: number | undefined): ReadonlySet<string> | undefined {
	if (!members || (memberCount !== undefined && memberCount > members.length)) return undefined;
	return new Set(members.map((member) => member.user_id));
}

/**
 * The user IDs that `messages` mention (`body.mentions`, §3.5) who aren't among `memberIds` (`knownMemberIds`), once
 * each, in the order mentioned, as written: none while the members aren't all known. Members are listed by their
 * current IDs, so `current` gives the one an ID written before a change is now (§3.3): she's no less here for it.
 * A `mentions` that isn't a list (anyone may send one) names no one.
 */
export function absentInMessages(messages: readonly { body?: { mentions?: unknown } }[], memberIds: ReadonlySet<string> | undefined, current: (userId: string) => string = (userId) => userId): string[] {
	if (!memberIds) return [];
	const absent = new Set<string>();
	for (const message of messages) {
		const mentions = message.body?.mentions;
		if (!Array.isArray(mentions)) continue;
		for (const userId of mentions) if (typeof userId === 'string' && !absent.has(userId) && !memberIds.has(current(userId))) absent.add(userId);
	}
	return [...absent];
}

/**
 * A stylesheet that greys, in a pane's message text, the mention chips of `userIds` (those not in the room), the way
 * the composer greys a draft's (`ap-mention-quiet` in apron.css). The browser matches it, so no row draws again as
 * people join or leave. Each ID is escaped to hex beyond `[A-Za-z0-9_-]`, so nothing in one ends the rule. Empty
 * for no one.
 */
export function absentMentionsCss(userIds: readonly string[]): string {
	if (!userIds.length) return '';
	const escape = (id: string) => id.replace(/[^A-Za-z0-9_-]/gu, (char) => `\\${char.codePointAt(0)!.toString(16)} `);
	const selectors = userIds.map((id) => `.ap-timeline .ap-msg-text .ap-mention[data-user-id="${escape(id)}"]`);
	return `${selectors.join(',\n')} { background: color-mix(in srgb, var(--ink-muted) 14%, transparent); color: var(--ink-muted); }`;
}

/**
 * Says on a mention chip in a message why it's greyed (`absentMentionsCss`): while its person is among `absent`, its
 * tooltip and accessible description add `note`; once they aren't, they're as rendered. For the chip at or around
 * `target`, as the pointer or focus reaches it, so no row draws again for it.
 */
export function noteAbsentMention(target: EventTarget | null, absent: ReadonlySet<string>, note: string): void {
	if (!(target instanceof Element)) return;
	const chip = target.closest<HTMLElement>('.ap-msg-text .ap-mention[data-user-id]');
	if (!chip) return;
	const own = (chip.dataset.ownTitle ??= chip.title);
	if (absent.has(chip.dataset.userId ?? '')) {
		// The same words for a screen reader: a description of its own takes the place of the title's, @user_id and all.
		const tip = own ? `${own} · ${note}` : note;
		chip.title = tip;
		chip.setAttribute('aria-description', tip);
	} else {
		if (own) chip.title = own;
		else chip.removeAttribute('title');
		chip.removeAttribute('aria-description');
	}
}

const NO_ONE: MentionPerson[] = [];

/**
 * Those of `known` (everyone the session knows) a composer may mention though they aren't among `members`, marked
 * `outside`, to follow who is: none while the members aren't all known (`memberCount`), as `absentMentions`, and never
 * those `skip` names (you, the system identities, guests).
 */
export function outsidersOf(known: readonly Identity[], members: readonly Identity[] | undefined, memberCount: number | undefined, skip: (user: Identity) => boolean): MentionPerson[] {
	if (!members || (memberCount !== undefined && memberCount > members.length)) return NO_ONE;
	const here = new Set(members.map((member) => member.user_id));
	const outside: MentionPerson[] = [];
	for (const user of known) {
		if (here.has(user.user_id) || skip(user)) continue;
		const roles = Array.isArray(user.roles) ? user.roles.filter((role) => typeof role === 'string') : [];
		outside.push({ id: user.user_id, ...(user.name ? { name: user.name } : {}), ...(user.avatar ? { avatar: user.avatar } : {}), ...(roles.length ? { roles } : {}), outside: true });
	}
	return outside.length ? outside : NO_ONE;
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
