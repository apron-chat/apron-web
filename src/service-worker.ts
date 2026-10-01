/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { base, build, files, prerendered, version } from '$service-worker';
import { NOTIFICATION_CLICK, PUSH_CLICK, PUSH_ROOM_PARAM, PUSH_TAG_PARAM, closeOlderInGroup, pushNotification, pushTarget } from '$lib/ui/notifications';

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

// A push from the server (§4.7) is a message object: show it, replacing the page's notification
// of the same message and closing older ones of its room. Browsers expect every push to show a
// notification, so one that can't be read still says something arrived.
sw.addEventListener('push', (event) => {
	let payload: unknown;
	try {
		payload = event.data?.json();
	} catch {
		payload = undefined;
	}
	const shown = pushNotification(payload) ?? { title: 'Apron', options: { body: 'New message', tag: 'apron:push' } };
	const group = pushTarget(shown.options.data)?.group;
	event.waitUntil((async () => {
		await sw.registration.showNotification(shown.title, { icon: `${base}/icon-192.png`, ...shown.options });
		if (group !== undefined && shown.options.tag) closeOlderInGroup(await sw.registration.getNotifications(), group, shown.options.tag);
	})());
});

// A notification shown through here: bring a tab forward, and tell the tabs, so the one that
// raised it (see `showNotification`), or one on the pushing server (by its push tag), opens the
// room. Without a tab, a new one opens at the pushed room.
sw.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const data: unknown = event.notification.data;
	const push = pushTarget(data);
	event.waitUntil((async () => {
		const tabs = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
		if (tabs.length === 0) {
			const query = push ? new URLSearchParams({ [PUSH_ROOM_PARAM]: push.roomId, ...(push.tag ? { [PUSH_TAG_PARAM]: push.tag } : {}) }) : undefined;
			await sw.clients.openWindow(query ? `${APP_PAGE}?${query}` : APP_PAGE);
			return;
		}
		const message = push ? { type: PUSH_CLICK, target: push } : { type: NOTIFICATION_CLICK, target: data };
		for (const tab of tabs) tab.postMessage(message);
		await tabs[0].focus();
	})());
});
