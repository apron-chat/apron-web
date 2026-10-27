import type { ChatClient } from '$lib/protocol/client';

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
