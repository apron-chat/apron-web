/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { base, build, files, prerendered, version } from '$service-worker';
import { setAppBadge, type BadgeNavigator } from '$lib/ui/notifications';
import { loadEnabledPushIds, loadShownMarks, markShown } from '$lib/ui/push-store';
import { askPushId, handleClick, handlePush, isNewerMessage } from '$lib/ui/sw-handlers';

/**
 * Keeps each deploy's app files cached so the app opens fast, still opens
 * offline, and a tab left open across a deploy can still load its lazy chunks.
 * Only the app's own files and page loads are handled: the WebSocket,
 * uploads, files, streams and every backend's URLs go straight to the network.
 * It also shows message notifications where a page can't show its own, and
 * the messages the server pushes (§4.7).
 */
const sw = self as unknown as ServiceWorkerGlobalScope;

const PREFIX = 'apron-app-';
const CACHE = `${PREFIX}${version}`;
/** Deploys whose files stay cached: this one and the ones older tabs may still be running. */
const KEEP = 3;
const APP_PAGE = `${base}/`;
/** `version.json` is left out: it must always come from the network to tell a deploy happened. */
const ASSETS = new Set([...build, ...files, ...prerendered].filter((path) => !path.endsWith('/_app/version.json')));

sw.addEventListener('install', (event) => {
	// Take over right away: older tabs keep finding their files in the older caches.
	event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([...ASSETS])).then(() => sw.skipWaiting()));
});

sw.addEventListener('activate', (event) => {
	event.waitUntil((async () => {
		// Deploy versions are timestamps: newest first, drop all but the last few.
		const older = (await caches.keys())
			.filter((key) => key.startsWith(PREFIX) && key !== CACHE)
			.sort((a, b) => Number(b.slice(PREFIX.length)) - Number(a.slice(PREFIX.length)));
		await Promise.all(older.slice(KEEP - 1).map((key) => caches.delete(key)));
		await sw.clients.claim();
	})());
});

sw.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== sw.location.origin) return;

	// The page itself comes from the network, so a reload always gets the latest deploy; offline, the cached one.
	if (request.mode === 'navigate') {
		event.respondWith(fetch(request).catch(async () => (await caches.match(APP_PAGE)) ?? Response.error()));
		return;
	}

	// This deploy's copy first; then an older deploy's, for a chunk an older tab still asks for.
	if (ASSETS.has(url.pathname) || url.pathname.startsWith(`${base}/_app/immutable/`)) {
		event.respondWith((async () => (await (await caches.open(CACHE)).match(request)) ?? (await caches.match(request)) ?? fetch(request))());
	}
});

// Pushes and clicks on notifications (§4.7): see `sw-handlers.ts`.
sw.addEventListener('push', (event) => {
	event.waitUntil(handlePush(() => event.data?.json(), {
		registration: sw.registration,
		loadEnabled: loadEnabledPushIds,
		loadMarks: loadShownMarks,
		markShown: (group, messageId) => markShown(group, messageId, isNewerMessage),
		setBadge: (unread) => setAppBadge(sw.navigator as BadgeNavigator, unread),
		pageVisible: async () => (await sw.clients.matchAll({ type: 'window' })).some((tab) => tab.visibilityState === 'visible'),
		icon: `${base}/icon-192.png`
	}));
});

sw.addEventListener('notificationclick', (event) => {
	event.notification.close();
	event.waitUntil(handleClick(event.notification.data, {
		tabs: () => sw.clients.matchAll({ type: 'window', includeUncontrolled: true }),
		openWindow: (url) => sw.clients.openWindow(url),
		askPushId,
		page: APP_PAGE
	}));
});
