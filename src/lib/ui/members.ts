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
