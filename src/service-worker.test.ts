import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryIdb } from '$lib/test/idb';
import { saveEnabledPushIds } from '$lib/ui/push-store';
import { PUSH_CLICK, QUIET_PUSH } from '$lib/ui/notifications';

/**
 * The service worker's glue: its push and notification-click listeners hand
 * the events to `handlePush` and `handleClick` (tested on their own in
 * `sw-handlers.test.ts`) with the worker's registration, clients and the
 * IndexedDB that the page shares with it. Run against a stand-in `self`.
 */

vi.mock('$service-worker', () => ({ base: '/app', build: ['/app/_app/immutable/start.js'], files: ['/app/icon-192.png'], prerendered: [], version: '1700000000000' }));

type Listener = (event: unknown) => void;
const listeners = new Map<string, Listener>();
const idb = memoryIdb();
const shown: Array<{ title: string; options: NotificationOptions & { data?: unknown } }> = [];
let tabs: Array<{ visibilityState: string; postMessage: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn> }> = [];
const setAppBadge = vi.fn(async () => undefined);
const openWindow = vi.fn(async () => undefined);
const matchAll = vi.fn(async () => tabs);

beforeAll(async () => {
	vi.stubGlobal('indexedDB', idb);
	vi.stubGlobal('self', {
		addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
		location: { origin: 'https://apron.example' },
		navigator: { setAppBadge, clearAppBadge: vi.fn(async () => undefined) },
		registration: {
			showNotification: vi.fn(async (title: string, options: NotificationOptions) => void shown.push({ title, options })),
			getNotifications: async () => shown.map((entry) => ({ ...entry.options, title: entry.title, close: () => shown.splice(shown.indexOf(entry), 1) }))
		},
		clients: { matchAll, openWindow }
	});
	await import('./service-worker');
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
	shown.length = 0;
	tabs = [];
	vi.clearAllMocks();
});

/** Dispatches an extendable event to the worker's listener, and waits for what it asked to wait for. */
async function dispatch(type: string, event: Record<string, unknown>): Promise<void> {
	let work: Promise<unknown> = Promise.resolve();
	listeners.get(type)!({ ...event, waitUntil: (promise: Promise<unknown>) => (work = promise) });
	await work;
}

const push = (payload: unknown) => dispatch('push', { data: { json: () => payload } });
const message = { push_id: 'a1', unread: 4, message: { message_id: '10', room_id: 'general', from: { user_id: 'bob', name: 'Bob' }, body: { text: 'hello' } } };

describe('the service worker', () => {
	it('shows a pushed message for an account push is on for, with the app’s icon, and sets the badge', async () => {
		await saveEnabledPushIds(['a1']);
		await push(message);
		expect(shown.map((entry) => [entry.title, entry.options.body, entry.options.icon])).toEqual([['Bob · general', 'hello', '/app/icon-192.png']]);
		expect(setAppBadge).toHaveBeenCalledWith(4);
		// Remembered in the IndexedDB the page reads too, so it never notifies about it again.
		expect(idb.stored('apron-push', 'state').get('shown')).toEqual({ 'a1:general': '10' });
	});

	it('drops a push for an account push isn’t on for, as the page saved them', async () => {
		await saveEnabledPushIds(['b2']);
		await push(message);
		expect(shown.map((entry) => entry.title)).toEqual([QUIET_PUSH.title]);
		expect(setAppBadge).not.toHaveBeenCalled();
	});

	it('leaves the badge to a tab in view, counting tabs it doesn’t control yet', async () => {
		await saveEnabledPushIds(['a1']);
		tabs = [{ visibilityState: 'visible', postMessage: vi.fn(), focus: vi.fn() }];
		await push({ push_id: 'a1', unread: 2 });
		expect(setAppBadge).not.toHaveBeenCalled();
		expect(matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true });
	});

	it('shows the quiet stand-in for a push that isn’t JSON', async () => {
		await dispatch('push', { data: { json: () => JSON.parse('not json') } });
		expect(shown.map((entry) => entry.title)).toEqual([QUIET_PUSH.title]);
	});

	it('closes a clicked notification and opens its room at the app’s page when no tab is open', async () => {
		const close = vi.fn();
		await dispatch('notificationclick', { notification: { close, data: { push: true, roomId: 'general', pushId: 'a1' } } });
		expect(close).toHaveBeenCalled();
		expect(openWindow).toHaveBeenCalledWith('/app/?push_room=general&push_id=a1');
	});

	it('hands a clicked push to the tab signed in to its account', async () => {
		const tab = { visibilityState: 'hidden', postMessage: vi.fn((_message: unknown, ports?: MessagePort[]) => ports?.[0]?.postMessage({ pushId: 'a1' })), focus: vi.fn(async () => undefined) };
		tabs = [tab];
		const target = { push: true, roomId: 'general', pushId: 'a1' };
		await dispatch('notificationclick', { notification: { close: vi.fn(), data: target } });
		expect(tab.postMessage).toHaveBeenLastCalledWith({ type: PUSH_CLICK, target });
		expect(tab.focus).toHaveBeenCalled();
		expect(openWindow).not.toHaveBeenCalled();
	});
});
