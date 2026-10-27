import { UNSUPPORTED, type ChatClient, type ClientSnapshot, type RoomSnapshot } from '$lib/protocol/client';
import { compareLogIds } from '$lib/protocol/reducer';
import type { Identity } from '$lib/protocol/types';
import { notPrivate } from './created';
import { addMembers, type Refusal } from './members';

/**
 * Private rooms (§4.2.4) as people use them to talk: the joined top-level ones the sidebar lists under Private, the
 * one you already have with someone, and starting one. Everything here goes by `private: true` and
 * `parent_room_id`, never by a `room_id`, which is opaque (§2.4).
 */

/** How long starting a room waits for its record after the server named it (it usually comes first). */
const JOINED_WAIT_MS = 10_000;

/** What a server that keeps no private rooms is told it can't do (§4.2.4: it rejects one as `unsupported`). */
export const NO_PRIVATE_ROOMS = 'This server doesn’t have private rooms.';

/** A joined top-level private room: listed under Private, and counted against `ext.settings.private_rooms`. */
export function isPrivateRoom(room: Pick<RoomSnapshot, 'joined' | 'private' | 'parentRoomId'>): boolean {
	return room.joined && room.private === true && room.parentRoomId === undefined;
}

/** The rooms that count against `ext.settings.private_rooms`: every joined top-level private room. */
export function privateRooms<T extends Pick<RoomSnapshot, 'joined' | 'private' | 'parentRoomId'>>(rooms: readonly T[]): T[] {
	return rooms.filter(isPrivateRoom);
}

/** A room's members other than you, as listed; empty while they aren't known. */
export function othersIn(room: Pick<RoomSnapshot, 'members'> | undefined, you: string | undefined): Identity[] {
	return (room?.members ?? []).filter((member) => member.user_id !== you);
}

/**
 * The room you already talk to someone in: joined, private, top-level and untitled (`namedForMembers`), with
 * exactly the two of you as members, from a complete listing (a truncated one says nothing for sure).
 */
export function directRoomWith(rooms: readonly RoomSnapshot[], you: string | undefined, userId: string): RoomSnapshot | undefined {
	if (you === undefined || userId === you) return undefined;
	return rooms.find((room) => {
		if (!isPrivateRoom(room) || !room.namedForMembers || !room.members || room.memberCount !== undefined) return false;
		const ids = new Set(room.members.map((member) => member.user_id));
		return ids.size === 2 && ids.has(you) && ids.has(userId);
	});
}

/** Rooms by how long they've been quiet, the quietest (oldest `latest_log_id`, or none known) first. */
export function quietestFirst<T extends Pick<RoomSnapshot, 'latestLogId'>>(rooms: readonly T[]): T[] {
	const at = (room: T) => (room.latestLogId === undefined ? -1 : Number(room.latestLogId));
	return [...rooms].sort((a, b) => at(a) - at(b));
}

/**
 * The line under an untitled private room's name: who can see it, with the one other person's status in words
 * where there is one ("Online · only you and Bob can see this room").
 */
export function privateRoomLine(others: readonly string[], status?: string): string {
	if (others.length === 0) return 'Only you can see this room';
	if (others.length > 1) return 'Only members can see this room';
	return status ? `${status} · only you and ${others[0]} can see this room` : `Only you and ${others[0]} can see this room`;
}

/**
 * Whether a top-level room's loaded history reaches back to its creation, where its PrivateIntro goes: all of it is
 * loaded, and the least position still retrievable (`history_log_id`, §4.3.3) is at or before the room's first record
 * seen, or nothing is retrievable at all (a room with nothing in it yet). Retention past it hides the intro.
 */
export function reachesStart(room: Pick<RoomSnapshot, 'loaded' | 'recovering' | 'olderAvailable' | 'historyLogId' | 'firstRecordLogId' | 'record'>): boolean {
	if (!room.loaded || room.recovering || room.olderAvailable) return false;
	if (room.historyLogId === null) return true;
	const start = room.firstRecordLogId ?? room.record?.log_id;
	return room.historyLogId !== undefined && start !== undefined && compareLogIds(room.historyLogId, start) <= 0;
}

/** Resolves with the room once the client lists it as joined; rejects after `waitMs` without it. */
export function whenJoined(client: Pick<ChatClient, 'subscribe'>, roomId: string, waitMs = JOINED_WAIT_MS): Promise<RoomSnapshot> {
	return new Promise((resolve, reject) => {
		let stop: (() => void) | undefined;
		let done = false;
		const timer = setTimeout(() => finish(() => reject(new Error('The new room never arrived. Look for it under Private.'))), waitMs);
		const finish = (settle: () => void) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			stop?.();
			settle();
		};
		stop = client.subscribe((snapshot) => {
			const room = snapshot.rooms.find((candidate) => candidate.id === roomId && candidate.joined);
			if (room) finish(() => resolve(room));
		});
		// `subscribe` calls back at once, before it returns what stops it.
		if (done) stop();
	});
}

/** A private room just started, and anyone who couldn't be added to it, with the server's words why. */
export interface StartedRoom {
	roomId: string;
	failed: Refusal[];
}

/**
 * Starts a private room with `people`: `room_set` with `private: true` (and the title, if any) and no
 * `parent_room_id` (§4.2.4), which joins you; then, once its record says it is private, adds each person in turn with
 * `room_join` and their `user_id` (§4.2.2); `named` hears its `room_id` as soon as the server says it. A refusal to create it rejects, with the server's message, or saying the
 * server has no private rooms (`unsupported`); so does a room that came back without `private: true`, which nobody is
 * added to (it stays joined, to leave). An add that fails doesn't stop the rest: the room is kept, and the result
 * says who and why.
 */
export async function startPrivateRoom(
	client: Pick<ChatClient, 'createRoom' | 'joinRoom' | 'subscribe'>, people: readonly string[], options: { title?: string; named?: (roomId: string) => void } = {}
): Promise<StartedRoom> {
	let roomId: string;
	try {
		const result = await client.createRoom({ private: true, ...(options.title ? { title: options.title } : {}) }).promise;
		if (typeof result.room_id !== 'string' || !result.room_id) throw new Error('Invalid room response');
		roomId = result.room_id;
	} catch (cause) {
		if ((cause as { code?: number } | undefined)?.code === UNSUPPORTED) throw new Error(NO_PRIVATE_ROOMS);
		throw cause instanceof Error ? cause : new Error('Unable to start a private room');
	}
	// Named before its record may arrive (a server can answer first): it's yours, not one someone added you to.
	options.named?.(roomId);
	const room = await whenJoined(client, roomId);
	if (!room.private) throw new Error(notPrivate(options.title));
	return { roomId, failed: await addMembers(client, roomId, people) };
}

/**
 * Watches the joined rooms for private ones someone else added you to: a top-level private room that arrives once
 * your rooms are listed, which this page didn't ask for (no room creation or join of it in flight, and not one it
 * started). Rooms listed when you sign in are known already; one you left and are added to again counts again.
 */
export class ArrivalWatch {
	private user: string | undefined;
	private known = new Set<string>();
	private started = new Set<string>();

	/** A room this page started or joined itself, which never counts as added. */
	mine(roomId: string): void {
		this.started.add(roomId);
	}

	/** The rooms that just arrived without this page asking, given the latest snapshot. */
	next(snapshot: Pick<ClientSnapshot, 'you' | 'rooms' | 'roomsListed' | 'pending'>): string[] {
		const you = snapshot.you?.user_id;
		if (!snapshot.roomsListed || you === undefined) return [];
		const ids = new Set(snapshot.rooms.filter((room) => room.joined).map((room) => room.id));
		if (you !== this.user) {
			this.user = you;
			this.known = ids;
			return [];
		}
		const asked = (roomId: string) => this.started.has(roomId)
			|| snapshot.pending.some((request) => (request.method === 'room_set' && request.room === undefined) || (request.method === 'room_join' && request.room === roomId));
		const arrived = snapshot.rooms.filter((room) => isPrivateRoom(room) && !this.known.has(room.id) && !asked(room.id)).map((room) => room.id);
		this.known = ids;
		return arrived;
	}
}
