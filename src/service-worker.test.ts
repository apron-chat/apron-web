import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryIdb } from '$lib/test/idb';
import { loadRegisterAgain, PUSH_RESUBSCRIBED, saveEnabledPushIds } from '$lib/ui/push-store';
import { NOTIFICATION_CLICK, PUSH_CLICK, QUIET_PUSH } from '$lib/ui/notifications';

/**
 * The service worker's push and notification-click listeners, through
 * `handlePush` and `handleClick` (`sw-handlers.ts`), with the worker's
 * registration, clients and the IndexedDB that the page shares with it. Run
 * against a stand-in `self`. What to show for a push is `planPush`'s decision
 * (`notifications.test.ts` › planning a push); these are what the worker
 * does with it.
 */

vi.mock('$service-worker', () => ({
	base: '/app',
	build: ['/app/_app/immutable/start.js', '/app/_app/immutable/assets/nunito-latin.abc.woff2'],
	files: ['/app/icon-192.png', '/app/og.png', '/app/robots.txt'],
	prerendered: ['/app/', '/app/__preview'],
	version: '1700000000000'
}));

type Listener = (event: unknown) => void;
const listeners = new Map<string, Listener>();
const idb = memoryIdb();
const shown: Array<{ title: string; options: NotificationOptions & { data?: unknown; renotify?: boolean } }> = [];
let tabs: Array<{ visibilityState: string; postMessage: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn> }> = [];
const setAppBadge = vi.fn(async () => undefined);
const openWindow = vi.fn(async () => undefined);
const matchAll = vi.fn(async () => tabs);
const subscribe = vi.fn(async () => ({}));
/** The worker's cache, by URL or path. */
const cached = new Map<string, unknown>();
const key = (request: unknown) => (typeof request === 'string' ? request : (request as { url: string }).url);
const cache = {
	addAll: vi.fn(async (paths: string[]) => paths.forEach((path) => cached.set(path, `cached ${path}`))),
	match: async (request: unknown) => cached.get(key(request)),
	put: vi.fn(async (request: unknown, response: unknown) => void cached.set(key(request), response))
};
/** An older deploy's cache, still kept for its tabs: made before this deploy's, so `caches.match` looks in it first. */
const olderCached = new Map<string, unknown>();

beforeAll(async () => {
	vi.stubGlobal('indexedDB', idb);
	vi.stubGlobal('caches', {
		open: async () => cache,
		match: async (request: unknown) => olderCached.get(key(request)) ?? cached.get(key(request)),
		keys: async () => []
	});
	vi.stubGlobal('self', {
		addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
		location: { origin: 'https://apron.example' },
		skipWaiting: async () => undefined,
		navigator: { setAppBadge, clearAppBadge: vi.fn(async () => undefined) },
		registration: {
			showNotification: vi.fn(async (title: string, options: NotificationOptions) => void shown.push({ title, options })),
			getNotifications: async () => shown.map((entry) => ({ ...entry.options, title: entry.title, close: () => shown.splice(shown.indexOf(entry), 1) })),
			pushManager: { subscribe }
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
	it('shows pushed messages for an account push is on for, with the app’s icon, closing the room’s older ones, and sets the badge', async () => {
		await saveEnabledPushIds(['a1']);
		// A tab out of view leaves the badge to the worker.
		tabs = [{ visibilityState: 'hidden', postMessage: vi.fn(), focus: vi.fn() }];
		await push(message);
		expect(shown.map((entry) => [entry.title, entry.options.body, entry.options.icon, entry.options.renotify])).toEqual([['Bob · general', 'hello', '/app/icon-192.png', false]]);
		expect(setAppBadge).toHaveBeenCalledWith(4);
		// Remembered in the IndexedDB the page reads too, so it never notifies about it again.
		expect(idb.stored('apron-push', 'state').get('shown')).toEqual({ 'a1:general': '10' });
		await push({ ...message, unread: 5, message: { ...message.message, message_id: '11', body: { text: 'again' } } });
		expect(shown.map((entry) => [entry.options.tag, entry.options.body])).toEqual([['apron:a1:11', 'again']]);
		expect(setAppBadge).toHaveBeenLastCalledWith(5);
		expect(idb.stored('apron-push', 'state').get('shown')).toEqual({ 'a1:general': '11' });
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

	it('only sets the badge for a badge push, and shows the quiet stand-in for a push that isn’t JSON', async () => {
		await saveEnabledPushIds(['a1']);
		await push({ push_id: 'a1', unread: 3 });
		expect(shown).toEqual([]);
		expect(setAppBadge).toHaveBeenCalledWith(3);
		await dispatch('push', { data: { json: () => JSON.parse('not json') } });
		expect(shown.map((entry) => entry.title)).toEqual([QUIET_PUSH.title]);
	});

	/**
	 * A tab of the app, signed in to the account with this `push_id` (none: a guest's), with its own id (none: a tab
	 * from before a deploy, which answers with its `push_id` only).
	 */
	const signedIn = (pushId?: string, tab?: string) => ({ visibilityState: 'hidden', postMessage: vi.fn((_message: unknown, ports?: MessagePort[]) => ports?.[0]?.postMessage({ pushId, ...(tab ? { tab } : {}) })), focus: vi.fn(async () => undefined) });

	it('closes a clicked notification and opens its room at the app’s page when no tab is signed in to its account', async () => {
		const close = vi.fn();
		tabs = [signedIn('b2')];
		await dispatch('notificationclick', { notification: { close, data: { push: true, roomId: 'general', pushId: 'a1' } } });
		expect(close).toHaveBeenCalled();
		expect(openWindow).toHaveBeenCalledWith('/app/#push_room=general&push_id=a1');
	});

	it('opens a window for a clicked push at its message, in its room or thread', async () => {
		tabs = [];
		await dispatch('notificationclick', { notification: { close: vi.fn(), data: { push: true, roomId: 'th1', pushId: 'a1', messageId: '1724803200042', group: 'a1:th1' } } });
		expect(openWindow).toHaveBeenCalledWith('/app/#push_room=th1&push_id=a1&push_message=1724803200042');
	});

	it('hands a clicked push to the tab signed in to its account, among all the app’s tabs', async () => {
		const other = signedIn('b2');
		const tab = signedIn('a1');
		tabs = [other, tab];
		const target = { push: true, roomId: 'general', pushId: 'a1' };
		await dispatch('notificationclick', { notification: { close: vi.fn(), data: target } });
		expect(tab.postMessage).toHaveBeenLastCalledWith({ type: PUSH_CLICK, target });
		expect(tab.focus).toHaveBeenCalled();
		expect(other.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: PUSH_CLICK }));
		expect(openWindow).not.toHaveBeenCalled();
		expect(matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true });
	});

	it('hands a clicked page notification to the tab that raised it, and brings that one forward, or opens the room once its tab has gone', async () => {
		const first = signedIn(undefined, 't0');
		const second = signedIn(undefined, 't1');
		tabs = [first, second];
		const data = { tab: 't1', server: 'wss://a/', roomId: 'general', threadId: 'th1', messageId: '5' };
		await dispatch('notificationclick', { notification: { close: vi.fn(), data } });
		expect(second.postMessage).toHaveBeenCalledWith({ type: NOTIFICATION_CLICK, target: data });
		expect(second.focus).toHaveBeenCalled();
		expect(first.focus).not.toHaveBeenCalled();
		expect(first.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: NOTIFICATION_CLICK }));
		expect(openWindow).not.toHaveBeenCalled();
		tabs = [];
		await dispatch('notificationclick', { notification: { close: vi.fn(), data } });
		expect(openWindow).toHaveBeenCalledWith('/app/#push_room=th1&push_message=5');
	});

	it('hands a page notification with a push_id to the tab that raised it, before another of its account', async () => {
		const other = signedIn('a1', 't0');
		const raiser = signedIn('a1', 't1');
		tabs = [other, raiser];
		const data = { tab: 't1', server: 'wss://a/', roomId: 'general', messageId: '5', pushId: 'a1', group: 'a1:general' };
		await dispatch('notificationclick', { notification: { close: vi.fn(), data } });
		expect(raiser.postMessage).toHaveBeenLastCalledWith({ type: NOTIFICATION_CLICK, target: data });
		expect(raiser.focus).toHaveBeenCalled();
		expect(other.focus).not.toHaveBeenCalled();
	});

	it('tells every tab about a clicked page notification when none says which it is, so the one that raised it opens the room', async () => {
		const first = signedIn();
		const second = signedIn();
		tabs = [first, second];
		const data = { tab: 't1', server: 'wss://a/', roomId: 'general' };
		await dispatch('notificationclick', { notification: { close: vi.fn(), data } });
		expect(second.postMessage).toHaveBeenCalledWith({ type: NOTIFICATION_CLICK, target: data });
		expect(first.focus).toHaveBeenCalled();
	});

	it('subscribes again with the old key when the push service replaces the subscription, and has the open tabs register it', async () => {
		const key = new Uint8Array([4, 1, 2]).buffer;
		const tab = signedIn('a1', 't1');
		tabs = [tab];
		await dispatch('pushsubscriptionchange', { oldSubscription: { options: { applicationServerKey: key, userVisibleOnly: true } }, newSubscription: null });
		expect(subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: key });
		expect(tab.postMessage).toHaveBeenCalledWith({ type: PUSH_RESUBSCRIBED });
		// Noted for a page that isn't open: the next to start registers it.
		expect(await loadRegisterAgain()).toBe(true);
		// One the browser made already is kept: it only needs registering.
		await dispatch('pushsubscriptionchange', { oldSubscription: { options: { applicationServerKey: key } }, newSubscription: { endpoint: 'https://push.example/2' } });
		expect(subscribe).toHaveBeenCalledTimes(1);
	});

	it('installs the app’s files but not the themes’ fonts, and keeps a font once a theme loads it', async () => {
		await dispatch('install', {});
		// Nor what the app never loads: the link preview's image, robots.txt, and a preview build's own page.
		expect(cache.addAll).toHaveBeenCalledWith(['/app/_app/immutable/start.js', '/app/icon-192.png', '/app/']);
		const font = { method: 'GET', mode: 'cors', url: 'https://apron.example/app/_app/immutable/assets/nunito-latin.abc.woff2' };
		const fetched = { ok: true, clone: () => 'kept font' };
		vi.stubGlobal('fetch', vi.fn(async () => fetched));
		let responded: Promise<unknown> | undefined;
		listeners.get('fetch')!({ request: font, respondWith: (promise: Promise<unknown>) => (responded = promise) });
		expect(await responded).toBe(fetched);
		expect(cache.put).toHaveBeenCalledWith(font, 'kept font');
		// The next time, it's the kept one.
		listeners.get('fetch')!({ request: font, respondWith: (promise: Promise<unknown>) => (responded = promise) });
		expect(await responded).toBe('kept font');
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('opens the app offline from this deploy’s page, and leaves other pages on its origin to the browser', async () => {
		await dispatch('install', {});
		olderCached.set('/app/', 'an older deploy’s page');
		vi.stubGlobal('fetch', vi.fn(async () => {
			throw new TypeError('offline');
		}));
		const navigate = (path: string) => {
			let responded: Promise<unknown> | undefined;
			listeners.get('fetch')!({ request: { method: 'GET', mode: 'navigate', url: `https://apron.example${path}` }, respondWith: (promise: Promise<unknown>) => (responded = promise) });
			return responded;
		};
		expect(await navigate('/app/?link=abc')).toBe('cached /app/');
		// A backend's file, or its live text, offline: the browser's own error, not the chat.
		expect(navigate('/app/files/1/photo.png')).toBeUndefined();
		expect(navigate('/app/live/x')).toBeUndefined();
		// The archive reader's page, which wasn't installed: it fails, rather than opening the chat in its place.
		expect(((await navigate('/app/archive')) as Response).type).toBe('error');
		olderCached.set('/app/archive', 'the archive reader');
		expect(await navigate('/app/archive')).toBe('the archive reader');
		olderCached.clear();
	});
});
