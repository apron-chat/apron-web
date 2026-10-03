/**
 * What the page and the service worker share about push, in IndexedDB (the
 * service worker can't read localStorage): the `push_id`s of the accounts
 * push is on for, so a push for any other is dropped (§4.7), and the newest
 * message each notification group has notified about, so a late push or
 * page notification never notifies about it again.
 */
const DB = 'apron-push';
const STORE = 'state';
const ENABLED = 'enabled';
const SHOWN = 'shown';
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

/** The enabled `push_id`s; undefined when unknown (never saved, or no IndexedDB). */
export async function loadEnabledPushIds(): Promise<string[] | undefined> {
	try {
		const value: unknown = await run('readonly', (store) => store.get(ENABLED));
		return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : undefined;
	} catch {
		return undefined;
	}
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
