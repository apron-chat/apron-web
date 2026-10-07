/**
 * The last view of a session, kept on this device so a reload paints it at
 * once: the rooms with their recent messages, the open room, its thread
 * listing, who you are and the server. It is `SessionView`'s held view, the
 * one a reconnect already shows while the connection rebuilds, so a reload
 * reads like a reconnect: what you had, then what arrived while you were away.
 *
 * It is for showing only. The client recovers every room as it always does;
 * nothing here stands in for a record, a checkpoint or a read cursor, and the
 * live view replaces it room by room (see `SessionView.prime`). One view per
 * server, for the account whose session is saved there. Messages older than a
 * day aren't kept, and a sign-out, or a sign-in as someone else, removes it.
 */
import type { RoomSnapshot } from '$lib/protocol/client';
import type { HeldSession } from './session.svelte';
import { idMillis } from './time';

const DB = 'apron-cache';
const STORE = 'views';
/** Bumped when what is kept changes shape: an older view is dropped, not misread. */
const VERSION = 1;
/** Messages are kept for a day: enough for a reload or the next morning, not a log of the room. */
export const MESSAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** The newest messages kept per room or thread, at most: what a reload shows without scrolling far. */
export const MESSAGES_PER_ROOM = 150;
/** A view older than this is dropped whole: the rooms and threads it lists may have changed too much to show. */
export const VIEW_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface KeptView {
	v: number;
	savedAt: number;
	/** The account the view belongs to: a session that signs in as anyone else drops it. */
	userId: string;
	view: HeldSession;
}

/**
 * What is kept of a room: its messages from the last day, the newest
 * `MESSAGES_PER_ROOM` of them, with their reactions and the join and leave
 * lines among them. It shows as catching up (`recovering`), not loaded, so
 * nothing reads it as the room's current state (the New divider, the read
 * cursor) before the live room replaces it. Notices, which are for one
 * connection, aren't kept.
 */
export function keptRoom(room: RoomSnapshot, now: number): RoomSnapshot {
	const cutoff = now - MESSAGE_MAX_AGE_MS;
	const recent = (id: string) => (idMillis(id) ?? 0) >= cutoff;
	const order = room.timeline.order.filter(recent).slice(-MESSAGES_PER_ROOM);
	const oldest = order[0];
	const events: Record<string, RoomSnapshot['timeline']['events'][string]> = {};
	const reactions: Record<string, RoomSnapshot['timeline']['reactions'][string]> = {};
	for (const id of order) {
		const event = room.timeline.events[id];
		if (event) events[id] = event;
		if (room.timeline.reactions[id]) reactions[id] = room.timeline.reactions[id];
	}
	const memberships = oldest === undefined ? [] : room.timeline.memberships.filter((record) => recent(record.log_id) && (idMillis(record.log_id) ?? 0) >= (idMillis(oldest) ?? 0));
	const { recoveryError: _error, loading: _loading, loadingOlder: _older, notices: _notices, ...rest } = room;
	return { ...rest, timeline: { ...room.timeline, events, order, reactions, memberships }, recovering: true, loaded: false, loading: false, notices: [] };
}

/** The view to keep: every room trimmed with `keptRoom`, and the open room's thread listing. */
export function keptView(view: HeldSession, now = Date.now()): HeldSession {
	const listing = view.activeRoom !== undefined ? view.threadDirectory?.[view.activeRoom] : undefined;
	return {
		rooms: view.rooms.map((room) => keptRoom(room, now)),
		...(view.activeRoom !== undefined ? { activeRoom: view.activeRoom } : {}),
		...(view.you ? { you: view.you } : {}),
		...(view.server ? { server: view.server } : {}),
		...(listing && view.activeRoom !== undefined ? { threadDirectory: { [view.activeRoom]: listing } } : {})
	};
}

/** A kept view still worth showing: this version, recent enough, and complete. */
export function usableView(kept: unknown, now = Date.now()): KeptView | undefined {
	if (!kept || typeof kept !== 'object') return undefined;
	const candidate = kept as Partial<KeptView>;
	if (candidate.v !== VERSION || typeof candidate.savedAt !== 'number' || typeof candidate.userId !== 'string') return undefined;
	if (now - candidate.savedAt > VIEW_MAX_AGE_MS || !candidate.view || !Array.isArray(candidate.view.rooms)) return undefined;
	return candidate as KeptView;
}

function open(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = globalThis.indexedDB.open(DB, 1);
		request.onupgradeneeded = () => request.result.createObjectStore(STORE);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function run<T>(mode: IDBTransactionMode, step: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	const db = await open();
	try {
		return await new Promise<T>((resolve, reject) => {
			const request = step(db.transaction(STORE, mode).objectStore(STORE));
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	} finally {
		db.close();
	}
}

/** The view kept for `server`, if there is a usable one. Never throws: without IndexedDB there is nothing kept. */
export async function loadView(server: string): Promise<KeptView | undefined> {
	try {
		const kept = usableView(await run('readonly', (store) => store.get(server)));
		if (!kept) void clearView(server);
		return kept;
	} catch {
		return undefined;
	}
}

/** Keeps `view` for `server` as `userId`'s, trimmed (`keptView`). Failing to write only loses the head start. */
export async function saveView(server: string, userId: string, view: HeldSession): Promise<void> {
	const kept: KeptView = { v: VERSION, savedAt: Date.now(), userId, view: keptView(view) };
	try {
		await run('readwrite', (store) => store.put(kept, server));
	} catch {
		// Private mode, a full quota, or a value the browser can't clone: the next reload starts as before.
	}
}

/** Removes what is kept for `server` (a sign-out, or another account), or for every server. */
export async function clearView(server?: string): Promise<void> {
	try {
		await run('readwrite', (store) => (server === undefined ? store.clear() : store.delete(server)));
	} catch {
		// Nothing to remove, or no IndexedDB.
	}
}
