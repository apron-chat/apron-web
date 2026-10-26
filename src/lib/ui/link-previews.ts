/**
 * Link previews the sender builds for links in a message: `link` embeds whose
 * `og` (PROTOCOL.md §4.8.1) describes what the link points to. The server has
 * the last word on `og` and may keep, replace, or drop it.
 *
 * Any link in the text is a candidate; the ones on a site in `SITES`
 * (`link-sites.ts`) get a preview, from that site's API, which allows
 * cross-origin reads, so the browser can describe a link without a server. A
 * preview is fetched when a link is pasted; a message sent before it arrives,
 * or for a link the API won't describe, gets a card built from the URL.
 */
import type { Embed, OpenGraph } from '$lib/protocol/types';
import { record, SITES, siteFor, type Lookup, type Site } from './link-sites';

/** At most this many previews per message. */
export const LINK_PREVIEWS_MAX = 3;
const CACHE_MAX = 100;

/** A link a site can describe. */
export type PreviewLink = Lookup & { site: Site };

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`]+/gi;
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

/**
 * A URL as written in text, without the punctuation that ends a sentence or
 * closes a bracket around it; a bracket the URL opened itself, as in
 * `/wiki/Mercury_(planet)`, stays.
 */
export function trimUrl(url: string): string {
	for (;;) {
		const last = url.at(-1) ?? '';
		const opener = CLOSERS[last];
		if (/[.,:;!?*_~]/.test(last) || (opener && url.split(last).length > url.split(opener).length)) url = url.slice(0, -1);
		else return url;
	}
}

/** The http(s) URLs written in `text`, in order. */
export function findUrls(text: string): URL[] {
	return [...text.matchAll(URL_IN_TEXT)].flatMap((match) => {
		try {
			return [new URL(trimUrl(match[0]))];
		} catch {
			return [];
		}
	});
}

/** The link `value` names on a site in `sites`, or undefined. */
export function previewLink(value: string | URL, sites: Record<string, Site> = SITES): PreviewLink | undefined {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return undefined;
	}
	if (!/^https?:$/.test(url.protocol)) return undefined;
	const site = siteFor(url, sites);
	const lookup = site?.match(url);
	return site && lookup && { ...lookup, site };
}

/** The distinct previewable links in a message's text, in order, up to `LINK_PREVIEWS_MAX`, leaving out links in `skip`. */
export function findLinks(text: string, skip: readonly string[] = [], sites: Record<string, Site> = SITES): PreviewLink[] {
	const found = new Map<string, PreviewLink>();
	for (const url of findUrls(text)) {
		const link = previewLink(url, sites);
		if (link && !found.has(link.url) && !skip.includes(link.url)) found.set(link.url, link);
		if (found.size >= LINK_PREVIEWS_MAX) break;
	}
	return [...found.values()];
}

/** When a limited answer says to try again: its `Retry-After` seconds, or `X-RateLimit-Reset` time, else in a minute. */
function retryAt(response: Response, now: number): number {
	const after = Number(response.headers.get('retry-after'));
	if (response.headers.get('retry-after') && Number.isFinite(after) && after >= 0) return now + after * 1000;
	const reset = Number(response.headers.get('x-ratelimit-reset'));
	return Number.isFinite(reset) && reset > 0 ? reset * 1000 : now + 60_000;
}

/**
 * Fetches and remembers previews by link. Sites limit unauthenticated calls,
 * so each link is asked for once, and a rate-limited answer holds further
 * requests to that site until the limit resets.
 */
export class LinkPreviews {
	private readonly known = new Map<string, OpenGraph | null>();
	private readonly pending = new Map<string, Promise<void>>();
	private readonly blockedUntil = new Map<string, number>();
	private readonly listeners = new Set<() => void>();

	constructor(
		private readonly fetcher: typeof fetch = (...args) => globalThis.fetch(...args),
		private readonly now: () => number = Date.now,
		private readonly sites: Record<string, Site> = SITES
	) {}

	/** Calls `listener` whenever a fetched preview arrives; returns the unsubscribe. */
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** The previewable links in `text`, as `findLinks` finds them with this instance's sites. */
	links(text: string, skip: readonly string[] = []): PreviewLink[] {
		return findLinks(text, skip, this.sites);
	}

	/** Starts fetching previews for the links in `text`; resolves when they have settled. */
	prefetch(text: string): Promise<void> {
		return Promise.all(this.links(text).map((link) => this.load(link))).then(() => undefined);
	}

	/**
	 * `link` embeds for the links in `text`: fetched details where they've
	 * arrived, else what the URL says. Links in `dismissed` are left out.
	 */
	embeds(text: string, dismissed: readonly string[] = []): Embed[] {
		return this.links(text, dismissed).flatMap((link) => {
			const og = this.known.get(link.url) ?? link.fallback;
			return og ? [{ kind: 'link', url: link.url, og }] : [];
		});
	}

	private load(link: PreviewLink): Promise<void> {
		if (this.known.has(link.url)) return Promise.resolve();
		const running = this.pending.get(link.url);
		if (running) return running;
		if (this.now() < (this.blockedUntil.get(link.site.name) ?? 0)) return Promise.resolve();
		const request = this.request(link).finally(() => this.pending.delete(link.url));
		this.pending.set(link.url, request);
		return request;
	}

	private async request(link: PreviewLink): Promise<void> {
		let response: Response;
		try {
			response = await this.fetcher(link.api, { credentials: 'omit', ...(link.headers ? { headers: link.headers } : {}) });
		} catch {
			return;
		}
		if ((link.site.limited ?? [429]).includes(response.status)) {
			this.blockedUntil.set(link.site.name, retryAt(response, this.now()));
			return;
		}
		let og: OpenGraph | undefined;
		if (response.ok) {
			try {
				og = link.preview(record(await response.json()));
			} catch {
				return;
			}
		} else if (!(link.site.missing ?? [404]).includes(response.status)) {
			return;
		}
		// A link with nothing to describe (private, or not there) is remembered too, so it isn't asked for again.
		this.remember(link.url, og ?? null);
	}

	private remember(url: string, og: OpenGraph | null): void {
		if (this.known.size >= CACHE_MAX) this.known.delete(this.known.keys().next().value as string);
		this.known.set(url, og);
		for (const listener of this.listeners) listener();
	}
}

/** The page's previews, shared by every room's composer. */
export const linkPreviews = new LinkPreviews();
