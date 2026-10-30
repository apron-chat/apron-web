import { isCommand, meAction } from '$lib/design/components/compose';
import type { MediaTypes, ServerMedia } from '$lib/protocol/client';

/**
 * What the composer does with its text (PROTOCOL.md §4.1). With capability `command`,
 * text that starts with one `/` is a command: `/nick`, `/join`, `/leave` and
 * `/topic` map to the requests they spell (all but the first need capability
 * `rooms`), and anything else goes to the server as a `command`, so these
 * names are the only ones the client keeps from it. `//` posts a message
 * starting with `/`. Without capability `command`, every text is a message.
 * Either way, `/me waves` posts the message `_waves_`, an action in italics.
 */
export type ComposerAction =
	| { kind: 'message'; text: string }
	| { kind: 'command'; text: string }
	| { kind: 'nick'; name: string }
	| { kind: 'join'; room: string }
	| { kind: 'leave'; room?: string }
	/** `room_set` with the room's new `description` (§4.2.4). */
	| { kind: 'topic'; description: string };

/** Composer text that is a command: one leading `/`, not `//`. The design system's Composer reads it the same way. */
export { isCommand };

export function composerAction(text: string, caps: { command: boolean; rooms: boolean }): ComposerAction {
	const action = meAction(text);
	if (action) return { kind: 'message', text: `_${action}_` };
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
	}
	return { kind: 'command', text };
}

/**
 * The server's limits for files sent with `action` (`ext:media`, EXT.md §6):
 * `emoji` for a `/emoji add` command (`ext:emoji`) where the server states
 * them, else `upload`.
 */
export function attachmentLimits(action: ComposerAction, media: Pick<ServerMedia, 'upload' | 'emoji'>): MediaTypes | undefined {
	if (action.kind === 'command' && media.emoji && /^\/emoji\s+add(\s|$)/i.test(action.text)) return media.emoji;
	return media.upload;
}
