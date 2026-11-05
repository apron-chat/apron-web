import { startKeeping } from '$lib/history/startup';
import { defaultWebSocketUrl, normalizeWebSocketUrl } from '$lib/protocol/client-views';
import { openEarlyConnection } from '$lib/protocol/early-connection';
import { memorySocket } from '$lib/preview/memory-socket';
import { PREVIEW_SERVER } from '$lib/preview/preview-server';
import { readDestination } from '$lib/ui/address';
import { PUSH_ROOM_PARAM } from '$lib/ui/notifications';
import { startServer } from '$lib/ui/start-server';
import { loadRecentServers, loadServerUrl } from '$lib/ui/storage';

/**
 * As the app starts, before it loads the page: what is kept on this device for the next session begins to be read,
 * and the connection to the server the page will sign in to begins to open (`$lib/protocol/early-connection`), so
 * its handshake goes on while the page's code loads.
 */
export function init(): void {
	const path = window.location.pathname;
	// Only for the page that signs in (`/`): `/__preview` and `/archive` keep nothing.
	if (path === '/') {
		startKeeping();
		connectEarly();
	} else if (__APRON_PREVIEW__ && path === '/__preview') {
		// The preview's page connects to its in-memory server, as `/` does to a real one. The server's code comes with
		// the page: the socket opens now, and the server hears of it once that code has loaded, as if it had all along.
		const knobs = (window as { __APRON_PREVIEW__?: { rttMs?: number } }).__APRON_PREVIEW__;
		const host = import('$lib/preview/memory-server').then(({ previewHost }) => previewHost());
		host.catch(() => undefined);
		openEarlyConnection(normalizeWebSocketUrl(PREVIEW_SERVER), (url) => memorySocket(url, host, knobs?.rttMs ?? 0));
	}
}

/** Opens the connection the page's client will take, to the server it will connect to, as it would (`startServer`). */
function connectEarly(): void {
	try {
		// The client waits to connect while the page is hidden or offline: so does this.
		if (document.visibilityState === 'hidden' || navigator.onLine === false) return;
		const location = window.location;
		// A notification's link names its room only (`takePushRoom`, which counts one with a room, as this does).
		const link = new URLSearchParams(location.hash.slice(1)).get(PUSH_ROOM_PARAM) ? {} : readDestination(location);
		openEarlyConnection(startServer(loadServerUrl() ?? defaultWebSocketUrl(location), link, loadRecentServers(), location).server);
	} catch {
		// Never in the way of the app starting: the client connects itself.
	}
}
