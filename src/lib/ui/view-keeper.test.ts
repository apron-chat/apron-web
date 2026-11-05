import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryIdb } from '$lib/test/idb';
import { memoryStorage } from '$lib/test/storage';
import { keptSessionUserKey } from '$lib/protocol/client-internals';
import { messageRecord, roomSnapshot } from '$lib/test/builders';
import { VIEW_SAVE_MS, ViewKeeper, type KeeperClient } from './view-keeper';
import { VIEW_MAX_AGE_MS } from './session-cache';
import { historySettings } from '$lib/history/settings.svelte';
import type { HeldSession } from './session.svelte';

const SERVER = 'wss://chat.example/';
const now = Date.UTC(2026, 9, 7, 12, 0, 0);
const ada = { user_id: 'ada', name: 'Ada' };
const view: HeldSession = { rooms: [roomSnapshot('general', [messageRecord(now - 1000)])], activeRoom: 'general', you: ada };

/** A client on `SERVER`, with a session saved on this device for `saved` (a passkey or email account), or none (a guest). */
const client = (saved: string[] = [SERVER], url = SERVER): KeeperClient => ({ url, keptSessionFor: (server) => saved.includes(server) });

function keeper(options: { enabled?: boolean } = {}) {
	const idb = memoryIdb();
	let clock = now;
	const value = new ViewKeeper({ indexedDB: idb, now: () => clock, ...options });
	return { keeper: value, idb, kept: () => idb.stored('apron-cache', 'views'), advance: (ms: number) => (clock += ms) };
}

// What is kept is trimmed and dated by the clock: a fixed one.
beforeEach(() => vi.useFakeTimers({ now, toFake: ['Date'] }));
afterEach(() => vi.useRealTimers());

/** What `restore` hands the page to show, if anything. */
async function restored(keeper: ViewKeeper, from: KeeperClient): Promise<HeldSession | undefined> {
	let shown: HeldSession | undefined;
	await keeper.restore(from, (view) => (shown = view));
	return shown;
}

describe('keeping the view on this device', () => {
	it('keeps a saved session’s view for its account, and shows it on the next visit', async () => {
		const { keeper: first, idb, kept } = keeper();
		await first.keep(client(), view, ada);
		expect([...kept().keys()]).toEqual([SERVER]);
		expect(kept().get(SERVER)).toMatchObject({ userId: 'ada', view: { activeRoom: 'general', you: ada } });
		const next = new ViewKeeper({ indexedDB: idb });
		expect((await restored(next, client()))?.rooms.map((room) => room.id)).toEqual(['general']);
	});

	it('never keeps a guest’s view: their next visit is someone new', async () => {
		const { keeper: guest, kept } = keeper();
		await guest.keep(client([]), view, ada);
		// A session saved on another server doesn't count for this one.
		await guest.keep(client(['wss://other.example/']), view, ada);
		expect(kept().size).toBe(0);
	});

	it('keeps nothing without a view, an identity or a client, nor against the preview server', async () => {
		const { keeper: some, kept } = keeper();
		await some.keep(client(), undefined, ada);
		await some.keep(client(), view, undefined);
		await some.keep(undefined, view, ada);
		const { keeper: preview, kept: previewKept } = keeper({ enabled: false });
		await preview.keep(client(), view, ada);
		expect([kept().size, previewKept().size]).toEqual([0, 0]);
	});

	it('keeps and shows nothing with Retention’s Don’t keep, and removes what was kept', async () => {
		const other = 'wss://other.example/';
		const { keeper: before, idb, kept } = keeper();
		await before.keep(client(), view, ada);
		await before.keep(client([other], other), view, ada);
		expect(kept().size).toBe(2);
		const off = new ViewKeeper({ indexedDB: idb, keeping: () => false });
		expect(await restored(off, client())).toBeUndefined();
		expect(kept().size).toBe(0);
		await off.keep(client(), view, ada);
		expect(kept().size).toBe(0);
		// By default, as Retention says.
		const retention = historySettings.retention;
		historySettings.retention = 'off';
		try {
			await new ViewKeeper({ indexedDB: idb }).keep(client(), view, ada);
			expect(kept().size).toBe(0);
		} finally {
			historySettings.retention = retention;
		}
		await new ViewKeeper({ indexedDB: idb }).keep(client(), view, ada);
		expect(kept().size).toBe(1);
	});

	it('keeps it at most once per VIEW_SAVE_MS while the room is busy', async () => {
		const { keeper: busy, advance } = keeper();
		expect(busy.wait()).toBe(0);
		await busy.keep(client(), view, ada);
		expect(busy.wait()).toBe(VIEW_SAVE_MS);
		advance(VIEW_SAVE_MS / 2);
		expect(busy.wait()).toBe(VIEW_SAVE_MS / 2);
		advance(VIEW_SAVE_MS);
		expect(busy.wait()).toBe(0);
		// A guest's view isn't kept, so it doesn't hold the next one back.
		const { keeper: guest } = keeper();
		await guest.keep(client([]), view, ada);
		expect(guest.wait()).toBe(0);
	});
});

describe('showing the kept view', () => {
	it('shows it only while the session it was kept for is still saved here, never against the preview server or from an IndexedDB it can’t read', async () => {
		const { keeper: some, idb } = keeper();
		await some.keep(client(), view, ada);
		// Signed out elsewhere (no saved session now): the view isn't shown as a guest's.
		expect(await restored(some, client([]))).toBeUndefined();
		expect(await restored(some, client())).toBeDefined();
		// Nothing against the preview server, or when IndexedDB can’t be read.
		expect(await restored(new ViewKeeper({ indexedDB: idb, enabled: false }), client())).toBeUndefined();
		idb.failing = true;
		expect(await restored(some, client())).toBeUndefined();
	});

	it('shows only the view of the account whose session is saved here, where that is noted', async () => {
		const values = new Map<string, string>();
		vi.stubGlobal('localStorage', memoryStorage(values));
		try {
			const { keeper: some, kept } = keeper();
			await some.keep(client(), view, ada);
			// Not noted (a pasted token): the sign-in says whose it is, and drops the view if it isn't Ada's.
			expect(await restored(some, client())).toBeDefined();
			values.set(keptSessionUserKey(SERVER), 'ada');
			expect(await restored(some, client())).toBeDefined();
			// Signed in there as Bob since: Ada's view isn't shown, and goes.
			values.set(keptSessionUserKey(SERVER), 'bob');
			expect(await restored(some, client())).toBeUndefined();
			expect(kept().size).toBe(0);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('drops a view too old to show', async () => {
		const { keeper: some, idb, kept } = keeper();
		await some.keep(client(), view, ada);
		const stale = kept().get(SERVER) as { savedAt: number };
		kept().set(SERVER, { ...stale, savedAt: stale.savedAt - VIEW_MAX_AGE_MS - 1 });
		expect(await restored(new ViewKeeper({ indexedDB: idb }), client())).toBeUndefined();
		await vi.waitFor(() => expect(kept().size).toBe(0));
	});
});

describe('signing out', () => {
	it('removes the view kept for that server, and only that one', async () => {
		const other = 'wss://other.example/';
		const { keeper: some, kept } = keeper();
		await some.keep(client([SERVER, other]), view, ada);
		await some.keep(client([SERVER, other], other), view, ada);
		await some.forget(SERVER);
		expect([...kept().keys()]).toEqual([other]);
		expect(await restored(some, client())).toBeUndefined();
	});
});
