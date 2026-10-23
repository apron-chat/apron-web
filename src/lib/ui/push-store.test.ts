import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnabledPushIds, withShown } from './push-store';
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
