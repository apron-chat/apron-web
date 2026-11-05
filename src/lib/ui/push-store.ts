/**
 * What the page and the service worker share about push, in IndexedDB (the
 * service worker can't read localStorage): the `push_id`s of the accounts
 * push is on for, so a push for any other is dropped (§4.9), the newest
 * message each notification group has notified about, so a late push or
 * page notification never notifies about it again, whether the push
 * service replaced the subscription since a page last registered it, and the
 * titles of each account's rooms, so a push names its room as the page does.
 */
const DB = 'apron-push';
const STORE = 'state';
const ENABLED = 'enabled';
const SHOWN = 'shown';
const REGISTER_AGAIN = 'registerAgain';
const TITLES = 'titles';
/** Rooms whose titles are kept for each account: a push for any other names it by its `room_id`. */
export const TITLES_MAX = 500;
/** Groups remembered: the most recently notified. */
const SHOWN_MAX = 200;

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

/** The enabled `push_id`s as `loadEnabledPushIds` reads them: undefined when never saved, `unreadable` when the read failed. */
export type EnabledPushIds = string[] | undefined | 'unreadable';

/**
 * The enabled `push_id`s; undefined when never saved (before the page first
 * saved them), and `unreadable` when IndexedDB failed or holds something
 * else, which the service worker must not take for "never saved": it can't
 * tell then whose a push is.
 */
export async function loadEnabledPushIds(): Promise<EnabledPushIds> {
	let value: unknown;
	try {
		value = await run('readonly', (store) => store.get(ENABLED));
	} catch {
		return 'unreadable';
	}
	if (value === undefined) return undefined;
	return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : 'unreadable';
}

/** Writes of the enabled `push_id`s, one after another, so an older list never lands after a newer one. */
let enabledWrites: Promise<void> = Promise.resolve();

export function saveEnabledPushIds(ids: readonly string[]): Promise<void> {
	const list = [...ids];
	enabledWrites = enabledWrites.then(async () => {
		try {
			await run('readwrite', (store) => store.put(list, ENABLED));
		} catch {
			// Without IndexedDB, pushes aren't filtered by account.
		}
	});
	return enabledWrites;
}

/** The newest `message_id` notified about, by notification group. */
export async function loadShownMarks(): Promise<Record<string, string>> {
	try {
		const value: unknown = await run('readonly', (store) => store.get(SHOWN));
		return value && typeof value === 'object' ? (value as Record<string, string>) : {};
	} catch {
		return {};
	}
}

/** The marks with a group's newest message noted, keeping the most recently noted `SHOWN_MAX` groups; unchanged when not newer. */
export function withShown(marks: Record<string, string>, group: string, messageId: string, newer: (a: string, b: string) => boolean): Record<string, string> | undefined {
	const current = marks[group];
	if (current !== undefined && !newer(messageId, current)) return undefined;
	const next = { ...marks };
	delete next[group];
	next[group] = messageId;
	const keys = Object.keys(next);
	for (const key of keys.slice(0, Math.max(0, keys.length - SHOWN_MAX))) delete next[key];
	return next;
}

/**
 * Remembers that a group notified about this message, keeping the newest per
 * group. The read and the write are one transaction, so the page and the
 * service worker can't overwrite each other's marks.
 */
export async function markShown(group: string, messageId: string, newer: (a: string, b: string) => boolean): Promise<void> {
	try {
		const db = await open();
		try {
			await new Promise<void>((resolve, reject) => {
				const transaction = db.transaction(STORE, 'readwrite');
				const store = transaction.objectStore(STORE);
				const read = store.get(SHOWN);
				read.onsuccess = () => {
					const value: unknown = read.result;
					const next = withShown(value && typeof value === 'object' ? (value as Record<string, string>) : {}, group, messageId, newer);
					if (next) store.put(next, SHOWN);
				};
				transaction.oncomplete = () => resolve();
				transaction.onerror = () => reject(transaction.error);
				transaction.onabort = () => reject(transaction.error);
			});
		} finally {
			db.close();
		}
	} catch {
		// Remembering is best effort.
	}
}

/**
 * What the service worker posts to the app's tabs once the push service replaced the subscription
 * (`pushsubscriptionchange`): each registers it again, which the worker can't, having no connection.
 */
export const PUSH_RESUBSCRIBED = 'apron:push-resubscribed';

/**
 * Notes that the push service replaced the subscription, so the server's endpoint is dead: a page registers the new
 * one when it next can (`loadRegisterAgain`), and then forgets this (`clearRegisterAgain`).
 */
export async function markRegisterAgain(): Promise<void> {
	try {
		await run('readwrite', (store) => store.put(true, REGISTER_AGAIN));
	} catch {
		// The page registers on each connection anyway: the next start registers the new subscription.
	}
}

/** Whether the subscription was replaced since a page last registered it (`markRegisterAgain`). */
export async function loadRegisterAgain(): Promise<boolean> {
	try {
		return (await run('readonly', (store) => store.get(REGISTER_AGAIN))) === true;
	} catch {
		return false;
	}
}

export async function clearRegisterAgain(): Promise<void> {
	try {
		await run('readwrite', (store) => store.delete(REGISTER_AGAIN));
	} catch {
		// Left set, the next page registers once more, which changes nothing.
	}
}

/**
 * How a room is named in a notification, as the page names it (`notificationTitle`): its shown title, and whether
 * that is its members' names (`namedForMembers`).
 */
export interface RoomTitle {
	title: string;
	namedForMembers?: true;
}

/**
 * Kept as a list of `[push_id, [[room_id, title, named], …]]`, not as objects keyed by id: a `room_id` is any string
 * the server chose (§2.4), `__proto__` included.
 */
type KeptTitles = Array<[string, Array<[string, string, boolean]>]>;

/** What `TITLES` holds, as a map of maps, without anything of the wrong shape. */
function readTitles(value: unknown): Map<string, Map<string, RoomTitle>> {
	const accounts = new Map<string, Map<string, RoomTitle>>();
	if (!Array.isArray(value)) return accounts;
	for (const account of value) {
		if (!Array.isArray(account) || typeof account[0] !== 'string' || !Array.isArray(account[1])) continue;
		const rooms = new Map<string, RoomTitle>();
		for (const room of account[1]) {
			if (!Array.isArray(room) || typeof room[0] !== 'string' || typeof room[1] !== 'string' || !room[1]) continue;
			rooms.set(room[0], room[2] === true ? { title: room[1], namedForMembers: true } : { title: room[1] });
		}
		accounts.set(account[0], rooms);
	}
	return accounts;
}

/** The room titles kept for each account's `push_id`; empty when there are none or IndexedDB can't be read. */
export async function loadRoomTitles(): Promise<Map<string, Map<string, RoomTitle>>> {
	try {
		return readTitles(await run('readonly', (store) => store.get(TITLES)));
	} catch {
		return new Map();
	}
}

/**
 * Keeps `titles` as the room titles of the account with `pushId`, replacing what was kept for it, at most
 * `TITLES_MAX` of them; undefined `titles` forgets that account's. Accounts push is no longer on for here are
 * forgotten as well. The read and the write are one transaction, so tabs of different accounts can't undo each other.
 */
export async function saveRoomTitles(pushId: string, titles: ReadonlyMap<string, RoomTitle> | undefined): Promise<void> {
	try {
		const db = await open();
		try {
			await new Promise<void>((resolve, reject) => {
				const transaction = db.transaction(STORE, 'readwrite');
				const store = transaction.objectStore(STORE);
				const read = store.get(TITLES);
				const enabled = store.get(ENABLED);
				enabled.onsuccess = () => {
					const accounts = readTitles(read.result);
					if (titles) accounts.set(pushId, new Map([...titles].slice(0, TITLES_MAX)));
					else accounts.delete(pushId);
					const on: unknown = enabled.result;
					if (Array.isArray(on)) for (const id of accounts.keys()) if (id !== pushId && !on.includes(id)) accounts.delete(id);
					const kept: KeptTitles = [...accounts].map(([id, rooms]) => [id, [...rooms].map(([room, { title, namedForMembers }]) => [room, title, namedForMembers === true])]);
					if (kept.length) store.put(kept, TITLES);
					else store.delete(TITLES);
				};
				transaction.oncomplete = () => resolve();
				transaction.onerror = () => reject(transaction.error);
				transaction.onabort = () => reject(transaction.error);
			});
		} finally {
			db.close();
		}
	} catch {
		// Without them, a push names its room by its `room_id`, as before.
	}
}
