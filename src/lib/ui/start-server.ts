import { defaultWebSocketUrl, normalizeWebSocketUrl } from '$lib/protocol/client-views';
import type { Destination } from './address';

/**
 * The server the page connects to as it starts (`server`), from the one last used here (`saved`) and the page's link
 * (issue #32): a link's server used here before (`recents`), or the page's own, is switched to at once; any other is
 * `offered`, for the viewer to choose on the connect screen, while the page connects as it would have. A link without
 * a server is for the page's own. The page (`+page.svelte`) and the connection opened as the app starts
 * (`hooks.client.ts`) both go by it, so they agree.
 */
export function startServer(saved: string, link: Destination, recents: readonly { url: string }[], location: Location): { server: string; offered?: string } {
	const home = normalizeWebSocketUrl(defaultWebSocketUrl(location), location);
	const current = normalizeWebSocketUrl(saved, location);
	const linked = link.server ?? (link.room ? home : undefined);
	if (!linked || linked === current) return { server: current };
	if (linked === home || recents.some((recent) => recent.url === linked)) return { server: linked };
	return { server: current, offered: linked };
}
