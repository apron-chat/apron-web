/**
 * What the composer does with its text (PROTOCOL.md §4.1). With capability `command`,
 * text that starts with one `/` is a command: `/nick`, `/join`, `/leave`,
 * `/topic`, `/kick` and `/invite` map to the requests they spell (all but the
 * first need capability `rooms`), and anything else goes to the server as a
 * `command`. `//` posts a message starting with `/`. Without capability `command`,
 * every text is a message.
 */
export type ComposerAction =
	| { kind: 'message'; text: string }
	| { kind: 'command'; text: string }
	| { kind: 'nick'; name: string }
	| { kind: 'join'; room: string }
	| { kind: 'leave'; room?: string }
	/** `room_set` with the room's new `description` (§4.3.4). */
	| { kind: 'topic'; description: string }
	/** `room_leave` with the `user_id` of the member to remove (§4.3.2). */
	| { kind: 'kick'; user: string }
	/** `room_join` with the `user_id` of the user to add (§4.3.2). */
	| { kind: 'invite'; user: string };

/** Composer text that is a command: one leading `/`, not `//`. */
export function isCommand(text: string): boolean {
	return text.startsWith('/') && !text.startsWith('//');
}

/** A lone user argument, written `@user_id` or as the bare ID, as a mention chip sends it. */
const USER_ARGUMENT = /^@?([A-Za-z0-9_.-]+)$/;

/**
 * `caps.members`: adding and removing other members (`room_join` and
 * `room_leave` with `user_id`) is worth trying; once the server answered it
 * `unsupported`, `/kick` and `/invite` go to the server as commands instead. `mentions`: the `user_id`s the draft's chips name,
 * exact where the text is not: in text, a trailing `.` or `-` is not part of
 * an ID (Appendix A.3), so `/kick @al-` names `al` unless a chip says `al-`.
 */
export function composerAction(text: string, caps: { command: boolean; rooms: boolean; members?: boolean }, mentions: readonly string[] = []): ComposerAction {
	if (!caps.command) return { kind: 'message', text };
	if (text.startsWith('//')) return { kind: 'message', text: text.slice(1) };
	if (!isCommand(text)) return { kind: 'message', text };
	const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trimEnd());
	const name = match?.[1].toLowerCase();
	const argument = match?.[2]?.trim() ?? '';
	if (name === 'nick' && argument) return { kind: 'nick', name: argument };
	if (caps.rooms) {
		// A room may be written as its ID or `#ID`.
		if (name === 'join' && argument) return { kind: 'join', room: argument.replace(/^#/, '') };
		if (name === 'leave') return argument ? { kind: 'leave', room: argument.replace(/^#/, '') } : { kind: 'leave' };
		if (name === 'topic' && argument) return { kind: 'topic', description: argument };
		// Only a bare user maps to a request: a reason is something only the server's own command can carry.
		const written = USER_ARGUMENT.exec(argument)?.[1];
		const user = written === undefined ? undefined
			: mentions.length === 1 && mentions[0].replace(/[.-]+$/, '') === written.replace(/[.-]+$/, '') ? mentions[0]
			: written.replace(/[.-]+$/, '');
		if (caps.members !== false && user) {
			if (name === 'kick') return { kind: 'kick', user };
			if (name === 'invite') return { kind: 'invite', user };
		}
	}
	return { kind: 'command', text };
}
