/**
 * The `user_id` typed to add someone to a room (§4.3.2): exactly that ID,
 * written bare or as `@user_id`. Display names are never looked up, since
 * they aren't unique (§3.3): adding by name could add an impersonator.
 * Undefined when the text can't be an ID (empty, or with spaces).
 */
export function userIdToAdd(typed: string): string | undefined {
	const id = typed.trim().replace(/^@/, '');
	return id && !/\s/.test(id) ? id : undefined;
}
