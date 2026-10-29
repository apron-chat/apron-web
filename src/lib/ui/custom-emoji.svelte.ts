/**
 * The connected server's custom emoji (extension `ext:emoji`): its catalog,
 * fetched the first time something needs it (the picker opens, or a key is
 * shown) and kept per `catalog_url` for the page's lifetime. Until it has
 * arrived, keys show as they do without the extension: as text, and in
 * reactions as a placeholder.
 */
import { catalogUrlOf, EMOJI_KEY, parseCatalog, type CustomEmoji, type EmojiCatalog } from '$lib/protocol/custom-emoji';
import { serverOrigin } from '$lib/protocol/embeds';
import type { CustomEmojiImage } from '$lib/protocol/markdown';
import type { ServerParams } from '$lib/protocol/types';

/** The largest catalog fetched, in characters: more is no catalog. */
const CATALOG_MAX = 4 * 1024 * 1024;

/** Fetches a catalog's JSON: no credentials and no referrer, so it reveals nothing the server doesn't put in its URL. */
export type CatalogFetch = (url: string) => Promise<unknown>;

const fetchCatalog: CatalogFetch = async (url) => {
	const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'follow' });
	if (!response.ok) throw new Error(`The emoji catalog answered ${response.status}`);
	const text = await response.text();
	if (text.length > CATALOG_MAX) throw new Error('The emoji catalog is too large');
	return JSON.parse(text) as unknown;
};

export class CustomEmojiCatalog {
	/** The connected server's `catalog_url`, while it lists `ext:emoji`. */
	url = $state<string | undefined>();
	/** Its catalog, once fetched. */
	catalog = $state.raw<EmojiCatalog | undefined>();
	/** The user prefers reduced motion: emoji show their `static_url` where they have one. */
	reducedMotion = $state(false);
	/** The chat server's origin, which emoji images may also load from (§4.8.6). */
	private origin: string | undefined;
	/** Catalogs fetched, by URL: a catalog stays as long as its URL does. */
	private readonly fetched = new Map<string, EmojiCatalog>();
	/** The URLs being fetched, and those that failed (not tried again until the server sends another). */
	private readonly asked = new Set<string>();

	constructor(private readonly load: CatalogFetch = fetchCatalog) {
		const query = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
		if (query) {
			this.reducedMotion = query.matches;
			query.addEventListener?.('change', (event) => (this.reducedMotion = event.matches));
		}
	}

	/** Follows the server frame of the server at `serverUrl`: its catalog, fetched already or not yet. */
	apply(server: ServerParams | undefined, serverUrl: string | undefined): void {
		const url = catalogUrlOf(server);
		this.origin = serverUrl ? serverOrigin(serverUrl) : undefined;
		if (url === this.url) return;
		this.url = url;
		this.catalog = url ? this.fetched.get(url) : undefined;
	}

	/**
	 * Asks for the catalog, once: the picker opened, or a key is shown. Safe
	 * to call while rendering, since nothing changes until it has arrived.
	 */
	need(): void {
		const url = this.url;
		if (!url || this.catalog || this.asked.has(url)) return;
		this.asked.add(url);
		const origin = this.origin;
		this.load(url).then(
			(json) => {
				const catalog = parseCatalog(json, origin);
				this.fetched.set(url, catalog);
				if (this.url === url) this.catalog = catalog;
			},
			() => undefined
		);
	}

	/** The emoji for a key, once the catalog has it; asks for the catalog when a key is looked up before it arrived. */
	lookup(key: string): CustomEmoji | undefined {
		const catalog = this.catalog;
		if (!catalog) {
			if (this.url && EMOJI_KEY.test(key)) this.need();
			return undefined;
		}
		return catalog.get(key);
	}

	/** How an emoji shows: its still copy where the user prefers reduced motion, and its hover text. */
	image(emoji: CustomEmoji): CustomEmojiImage {
		return {
			src: this.reducedMotion && emoji.static_url ? emoji.static_url : emoji.url,
			alt: emoji.alt ?? emoji.key,
			...(emoji.width && emoji.height ? { width: emoji.width, height: emoji.height } : {})
		};
	}

	/** Resolves a key in text to its image (for `renderMarkdown`), or nothing to leave it text. */
	readonly resolve = (key: string): CustomEmojiImage | undefined => {
		const emoji = this.lookup(key);
		return emoji ? this.image(emoji) : undefined;
	};
}

/** The one catalog the page shows, for the server it is connected to. */
export const customEmoji = new CustomEmojiCatalog();
