import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keptSessionKey } from '$lib/protocol/client-internals';
import { memoryStorage } from '$lib/test/storage';
import { startKeeping, takeKeeper } from './startup';

/** The server the page starts on: the one its own address names (`defaultWebSocketUrl`). */
const SERVER = 'wss://chat.example/ws';

describe('startKeeping', () => {
	const values = new Map<string, string>();
	let requests: string[];
	beforeEach(() => {
		const indexedDB = new IDBFactory();
		requests = [];
		// What the page asks of IndexedDB as it starts, by kind.
		vi.stubGlobal('indexedDB', {
			open: (...args: Parameters<IDBFactory['open']>) => (requests.push('open'), indexedDB.open(...args)),
			databases: () => (requests.push('databases'), indexedDB.databases()),
			deleteDatabase: (name: string) => indexedDB.deleteDatabase(name)
		});
		vi.stubGlobal('localStorage', memoryStorage(values));
		vi.stubGlobal('window', { location: new URL('https://chat.example/') });
	});
	afterEach(() => {
		takeKeeper();
		values.clear();
		vi.unstubAllGlobals();
	});

	it('reads nothing kept where no session is saved for the server: a guest’s or a first visit has nothing to restore', async () => {
		startKeeping();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(requests).toEqual([]);
	});

	it('begins reading what is kept where a session is saved', async () => {
		values.set(keptSessionKey(SERVER), 'token');
		startKeeping();
		await vi.waitFor(() => expect(requests).toContain('databases'));
	});
});
