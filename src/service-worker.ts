/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { base, build, files, prerendered, version } from '$service-worker';
import { setAppBadge, type BadgeNavigator } from '$lib/ui/notifications';
import { loadEnabledPushIds, loadShownMarks, markRegisterAgain, markShown } from '$lib/ui/push-store';
import { anyWindowVisible, appWindows, askTab, handleClick, handlePush, handleSubscriptionChange, isNewerMessage } from '$lib/ui/sw-handlers';

/**
 * Keeps each deploy's app files cached so the app opens fast, still opens
 * offline, and a tab left open across a deploy can still load its lazy chunks.
 * Only the app's own files and page loads are handled: the WebSocket,
 * uploads, files, live text and every backend's URLs go straight to the network.
 * It also shows message notifications where a page can't show its own, and
 * the messages the server pushes (§4.9), and subscribes again when the push
 * service replaces the subscription.
 */
const sw = self as unknown as ServiceWorkerGlobalScope;

const PREFIX = 'apron-app-';
const CACHE = `${PREFIX}${version}`;
/** Deploys whose files stay cached: this one and the ones older tabs may still be running. */
const KEEP = 3;
const APP_PAGE = `${base}/`;
/** The archive reader's own page, which opens offline only once it has been installed with the rest. */
const ARCHIVE_PAGE = `${base}/archive`;
/** A font a theme carries (fonts.css), which loads only for a theme that uses it. */
const isFont = (path: string) => path.endsWith('.woff2');
/**
 * Static files the app itself never loads: the link preview's image (`og.png`, for other sites' crawlers) and
 * `robots.txt`. And the preview's page (`/__preview`), which only a preview build has, for its tests.
 */
const NOT_THE_APPS = new Set([`${base}/og.png`, `${base}/robots.txt`, `${base}/__preview`]);
/**
 * `version.json` is left out: it must always come from the network to tell a deploy happened. So are the fonts:
 * installing each for everyone would download the themes' fonts whatever the theme. One is kept once a theme loads it.
 */
const ASSETS = new Set([...build, ...files, ...prerendered].filter((path) => !path.endsWith('/_app/version.json') && !isFont(path) && !NOT_THE_APPS.has(path)));

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

	// The page itself comes from the network, so a reload always gets the latest deploy; offline, the cached one,
	// this deploy's first. Only the app's own pages: a backend's on this origin (its files, live text) offline is
	// the browser's own error, not the chat.
	if (request.mode === 'navigate') {
		const page = offlinePage(url.pathname);
		if (page) event.respondWith(fetch(request).catch(async () => (await cachedPage(page)) ?? Response.error()));
		return;
	}

	// This deploy's copy first; then an older deploy's, for a chunk an older tab still asks for.
	if (ASSETS.has(url.pathname) || url.pathname.startsWith(`${base}/_app/immutable/`)) {
		event.respondWith((async () => {
			const cache = await caches.open(CACHE);
			const cached = (await cache.match(request)) ?? (await caches.match(request));
			if (cached) return cached;
			const response = await fetch(request);
			// A theme's font, once loaded, stays for offline as the installed files do.
			if (isFont(url.pathname) && response.ok) await cache.put(request, response.clone());
			return response;
		})());
	}
});

/** The cached page a navigation to `path` falls back to offline: the app's own, or the archive reader's; none for any other. */
function offlinePage(path: string): string | undefined {
	if (path === APP_PAGE || path === base || path === `${APP_PAGE}index.html`) return APP_PAGE;
	if (path === ARCHIVE_PAGE || path === `${ARCHIVE_PAGE}/` || path === `${ARCHIVE_PAGE}.html`) return ARCHIVE_PAGE;
	return undefined;
}

/**
 * A page as this deploy cached it, else as an older deploy still kept did: `caches.match` alone looks through the
 * caches in the order they were made, so it would find the oldest deploy's first.
 */
async function cachedPage(page: string): Promise<Response | undefined> {
	return (await (await caches.open(CACHE)).match(page)) ?? (await caches.match(page));
}

// Pushes and clicks on notifications (§4.9): see `sw-handlers.ts`.
sw.addEventListener('push', (event) => {
	event.waitUntil(handlePush(() => event.data?.json(), {
		registration: sw.registration,
		loadEnabled: loadEnabledPushIds,
		loadMarks: loadShownMarks,
		markShown: (group, messageId) => markShown(group, messageId, isNewerMessage),
		setBadge: (unread) => setAppBadge(sw.navigator as BadgeNavigator, unread),
		pageVisible: () => anyWindowVisible(sw.clients),
		icon: `${base}/icon-192.png`
	}));
});

// The push service replaced the subscription: subscribe again, and have a page register it.
sw.addEventListener('pushsubscriptionchange', (event) => {
	event.waitUntil(handleSubscriptionChange(event, {
		pushManager: sw.registration.pushManager,
		markRegisterAgain,
		tabs: () => appWindows<WindowClient>(sw.clients)
	}));
});

sw.addEventListener('notificationclick', (event) => {
	event.notification.close();
	event.waitUntil(handleClick(event.notification.data, {
		tabs: () => appWindows<WindowClient>(sw.clients),
		openWindow: (url) => sw.clients.openWindow(url),
		askTab,
		page: APP_PAGE
	}));
});
