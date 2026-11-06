import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryIdb } from '$lib/test/idb';
import { clearRegisterAgain, loadEnabledPushIds, loadRegisterAgain, markRegisterAgain, saveEnabledPushIds, withShown } from './push-store';
import { loadRoomTitles, saveRoomTitles, TITLES_MAX } from './push-titles';
import { isNewerMessage } from './sw-handlers';

/** An IndexedDB whose one store holds `stored`, or whose open fails. */
function fakeIndexedDb(stored: Record<string, unknown> | 'failing') {
	const later = (run: () => void) => queueMicrotask(run);
	return {
		open() {
			const request: { result?: unknown; error?: unknown; onsuccess?: () => void; onerror?: () => void; onupgradeneeded?: () => void } = {};
			later(() => {
				if (stored === 'failing') {
					request.error = new Error('IndexedDB is unavailable');
					request.onerror?.();
					return;
				}
				request.result = {
					close: () => undefined,
					transaction: () => ({
						objectStore: () => ({
							get(key: string) {
								const read: { result?: unknown; onsuccess?: () => void } = {};
								later(() => {
									read.result = stored[key];
									read.onsuccess?.();
								});
								return read;
							}
						})
					})
				};
				request.onsuccess?.();
			});
			return request;
		}
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('the enabled push_ids', () => {
	it('reads the saved list, and tells a list never saved apart from a read that failed', async () => {
		vi.stubGlobal('indexedDB', fakeIndexedDb({ enabled: ['a1', 7, 'b2'] }));
		expect(await loadEnabledPushIds()).toEqual(['a1', 'b2']);
		vi.stubGlobal('indexedDB', fakeIndexedDb({}));
		expect(await loadEnabledPushIds()).toBeUndefined();
		vi.stubGlobal('indexedDB', fakeIndexedDb('failing'));
		expect(await loadEnabledPushIds()).toBe('unreadable');
		vi.stubGlobal('indexedDB', undefined);
		expect(await loadEnabledPushIds()).toBe('unreadable');
		vi.stubGlobal('indexedDB', fakeIndexedDb({ enabled: 'a1' }));
		expect(await loadEnabledPushIds()).toBe('unreadable');
	});
});

describe('remembering what a room notified about', () => {
	it('keeps the newest message per group, the most recent groups only', () => {
		expect(withShown({}, 'g', '5', isNewerMessage)).toEqual({ g: '5' });
		expect(withShown({ g: '5' }, 'g', '4', isNewerMessage)).toBeUndefined();
		expect(withShown({ g: '5' }, 'g', '5', isNewerMessage)).toBeUndefined();
		expect(withShown({ g: '5', h: '1' }, 'g', '10', isNewerMessage)).toEqual({ h: '1', g: '10' });
		const many = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`g${index}`, '1']));
		const next = withShown(many, 'new', '1', isNewerMessage)!;
		expect(Object.keys(next)).toHaveLength(200);
		expect(next.g0).toBeUndefined();
		expect(next.new).toBe('1');
	});
});

describe('a subscription the push service replaced', () => {
	it('is noted by the service worker for a page to register, until the page forgets it', async () => {
		const idb = memoryIdb();
		vi.stubGlobal('indexedDB', idb);
		expect(await loadRegisterAgain()).toBe(false);
		await markRegisterAgain();
		expect(await loadRegisterAgain()).toBe(true);
		await clearRegisterAgain();
		expect(await loadRegisterAgain()).toBe(false);
		// Unreadable: nothing to register again, as the page registers on each start anyway.
		idb.failing = true;
		await markRegisterAgain();
		expect(await loadRegisterAgain()).toBe(false);
	});
});

describe('the room titles kept for pushes', () => {
	it('keeps each account’s apart, replaces one account’s whole, and forgets accounts push is no longer on for', async () => {
		vi.stubGlobal('indexedDB', memoryIdb());
		await saveEnabledPushIds(['a1', 'b2']);
		await saveRoomTitles('a1', new Map([['general', { title: 'General' }], ['p1', { title: 'Bob', namedForMembers: true }]]));
		await saveRoomTitles('b2', new Map([['ops', { title: 'Ops' }]]));
		let kept = await loadRoomTitles();
		expect([...kept.keys()]).toEqual(['a1', 'b2']);
		expect([...kept.get('a1')!]).toEqual([['general', { title: 'General' }], ['p1', { title: 'Bob', namedForMembers: true }]]);
		await saveRoomTitles('a1', new Map([['general', { title: 'Town square' }]]));
		expect([...(await loadRoomTitles()).get('a1')!]).toEqual([['general', { title: 'Town square' }]]);
		// Push turned off for b2 elsewhere: the next save forgets its titles.
		await saveEnabledPushIds(['a1']);
		await saveRoomTitles('a1', new Map([['general', { title: 'Town square' }]]));
		kept = await loadRoomTitles();
		expect([...kept.keys()]).toEqual(['a1']);
		await saveRoomTitles('a1', undefined);
		expect((await loadRoomTitles()).size).toBe(0);
	});

	it('keeps a room_id that is any string, __proto__ included, and at most TITLES_MAX rooms an account', async () => {
		vi.stubGlobal('indexedDB', memoryIdb());
		await saveEnabledPushIds(['a1']);
		const many = new Map(Array.from({ length: TITLES_MAX + 5 }, (_, index) => [`r${index}`, { title: `Room ${index}` }]));
		many.set('__proto__', { title: 'Sneaky' });
		await saveRoomTitles('a1', new Map([['__proto__', { title: 'Sneaky' }], ...many]));
		const rooms = (await loadRoomTitles()).get('a1')!;
		expect(rooms.size).toBe(TITLES_MAX);
		expect(rooms.get('__proto__')).toEqual({ title: 'Sneaky' });
		expect(Object.getPrototypeOf({})).toBe(Object.prototype);
	});

	it('reads nothing of the wrong shape, and nothing when IndexedDB fails', async () => {
		const idb = memoryIdb();
		vi.stubGlobal('indexedDB', idb);
		await saveEnabledPushIds(['a1']);
		await saveRoomTitles('a1', new Map([['general', { title: 'General' }]]));
		idb.stored('apron-push', 'state').set('titles', [['a1', [['general', 7], ['ops', 'Ops', 'yes'], 'junk']], 'junk', [3, []]]);
		expect([...(await loadRoomTitles()).get('a1')!]).toEqual([['ops', { title: 'Ops' }]]);
		idb.failing = true;
		expect((await loadRoomTitles()).size).toBe(0);
		await saveRoomTitles('a1', new Map());
	});
});
