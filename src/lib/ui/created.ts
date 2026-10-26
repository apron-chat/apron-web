import type { RoomSnapshot } from '$lib/protocol/client';
import { threadLostPrivacy } from './timeline';

/**
 * Rooms and threads this page created, once their `room_update` has
 * arrived: opened, or, where the server didn't keep them private as asked
 * (§4.2.4), refused with a note, so nothing is posted or moved where others
 * can see it.
 */

/** A new thread of a private room that the server made visible to others (§4.2.4). */
export const PRIVACY_LOST = 'The server made the new thread visible to people outside this private room, so nothing was posted or moved into it. Leave it, or use it knowing that.';

/** A room created as private that the server made an ordinary one; one started without a title is "the new conversation". */
export const notPrivate = (title?: string) => `The server made ${title ? `“${title}”` : 'the new conversation'} an ordinary room that others can see and join, not a private one. Leave it, or use it knowing that.`;

/**
 * A thread this viewer created, opened once its `room_update` has arrived;
 * `replyTo`, the message it was started from, which its composer then
 * replies to (the thread-from-message convention).
 */
export interface PendingThread {
	room: string;
	thread: string;
	replyTo?: string;
	/** Messages were moved into it already: it opens whatever privacy its record shows, as that was checked before they moved. */
	moved?: true;
}

/**
 * What to do with a thread this viewer created: `wait` until it is listed;
 * then `open` it (with its composer), or `refuse` when its room is private
 * and the thread came back without `private`. One that messages were moved
 * into opens anyway: the move checked its privacy first (`moveCheck`).
 */
export function createdThread(pending: PendingThread, rooms: readonly Pick<RoomSnapshot, 'id' | 'private'>[]): 'wait' | 'open' | { refuse: string } {
	if (!rooms.some((room) => room.id === pending.thread)) return 'wait';
	if (!pending.moved && threadLostPrivacy(rooms, pending.room, pending.thread)) return { refuse: PRIVACY_LOST };
	return 'open';
}

/**
 * What to do with a room this viewer created (or joined), once it is
 * listed: open it, unless it was created as private and the server made it
 * an ordinary one.
 */
export function createdRoom<T extends Pick<RoomSnapshot, 'title' | 'private'>>(room: T, askedPrivate: boolean): { open: T } | { refuse: string } {
	return askedPrivate && !room.private ? { refuse: notPrivate(room.title) } : { open: room };
}

/**
 * The check a move into a new thread of `parentRoomId` makes once the thread
 * exists: nothing moves out of a private room into a thread others can see.
 */
export function moveCheck(rooms: () => readonly Pick<RoomSnapshot, 'id' | 'private'>[], parentRoomId: string): (threadId: string) => Error | undefined {
	return (threadId) => (threadLostPrivacy(rooms(), parentRoomId, threadId) ? new Error(PRIVACY_LOST) : undefined);
}
