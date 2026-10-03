import type { RoomSnapshot } from '$lib/protocol/client';
import type { Identity, MessageRecord } from '$lib/protocol/types';
import { isOwn } from './messages';

/**
 * What to notify about: one set of scopes for desktop notifications and push.
 * They are the wake scopes of §4.7. The page applies them itself, and push
 * sends the ones the server pushes as `wake`.
 */
export const NOTIFY_SCOPES = [
	{ value: 'mentions', title: 'Mentions' },
	{ value: 'replies', title: 'Replies to my messages' },
	{ value: 'private', title: 'All messages in private rooms' },
	{ value: 'joined', title: 'All messages in joined rooms' }
] as const;

export type NotifyScope = (typeof NOTIFY_SCOPES)[number]['value'];

/** Until an account chooses: mentions and replies, the protocol's default wake scopes. */
export const DEFAULT_NOTIFY_SCOPES: readonly NotifyScope[] = ['mentions', 'replies'];

/** Who the scopes of a guest are kept for: guests' `user_id`s change with each connection. */
export const GUEST_ACCOUNT = '~guest';

/** The account the scopes are kept for: one per signed-in account on each server, one for its guests. */
export function notifyAccount(serverUrl: string, userId: string | undefined): string {
	return `${serverUrl}\n${userId ?? GUEST_ACCOUNT}`;
}

/** Stored scopes as a choice: the known ones in their order, else the defaults. */
export function notifyScopesOf(stored: readonly string[] | undefined): NotifyScope[] {
	const scopes = NOTIFY_SCOPES.map((scope) => scope.value).filter((scope) => stored?.includes(scope));
	return scopes.length ? scopes : [...DEFAULT_NOTIFY_SCOPES];
}

/** What the page knows about an arriving message beyond itself. */
export interface NotifyContext {
	me: Identity | undefined;
	/** It mentions you (`body.mentions`), or an edit added you. */
	mentioned: boolean;
	/** The visible rooms, for the message's room and its reply target. */
	rooms: readonly RoomSnapshot[];
}

/**
 * Whether a message from someone else is in a checked scope, judged here:
 * `mentions`, it mentions you; `replies`, it replies to one of your messages
 * that is loaded here; `private`, its room (or a thread's room) is private;
 * `joined`, its room (or a thread's room) is joined. In a room you paused,
 * only `mentions` counts.
 */
export function inNotifyScopes(event: MessageRecord, scopes: readonly string[], context: NotifyContext): boolean {
	if (!context.me || isOwn(event, context.me) || event.deleted) return false;
	const room = context.rooms.find((candidate) => candidate.id === event.room_id);
	const parent = room?.parentRoomId === undefined ? undefined : context.rooms.find((candidate) => candidate.id === room.parentRoomId);
	// In a room you paused (§4.11 room `mute`), or a thread of one, only mentions notify.
	const muted = room?.mutedUntil !== undefined || parent?.mutedUntil !== undefined;
	return (muted ? scopes.filter((scope) => scope === 'mentions') : scopes).some((scope) => {
		switch (scope) {
			case 'mentions':
				return context.mentioned;
			case 'replies': {
				const target = event.reply_to?.message_id;
				if (target === undefined) return false;
				const replied = context.rooms.map((candidate) => candidate.timeline.events[target]).find((found) => found !== undefined);
				return Boolean(replied && !replied.deleted && isOwn(replied, context.me));
			}
			case 'private':
				return room?.private === true || parent?.private === true;
			case 'joined':
				return room?.joined === true || parent?.joined === true;
			default:
				return false;
		}
	});
}

/** The `wake` push sends (§4.7): the checked scopes the server pushes; undefined when it lists none (its defaults apply). */
export function pushWake(scopes: readonly string[], offered: readonly string[]): string[] | undefined {
	return offered.length ? scopes.filter((scope) => offered.includes(scope)) : undefined;
}

/** Notes beside checked scopes: while push is on, the ones the server doesn't push are desktop only. */
export function notifyScopeNotes(scopes: readonly string[], offered: readonly string[], pushOn: boolean): Record<string, string> {
	if (!pushOn || !offered.length) return {};
	return Object.fromEntries(scopes.filter((scope) => !offered.includes(scope)).map((scope) => [scope, 'Desktop only']));
}
