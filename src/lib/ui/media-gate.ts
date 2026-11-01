/**
 * The one way the app turns a URL into one a component loads as media (`MediaSrc`): a gate knows where media may
 * load from (the chat server's own origin, and the origins trusted besides it: those the server names with
 * `ext:media`, the viewer's trusted origins, or any, as Preferences' Media says, and the URLs clicked to load) and
 * lets through only URLs from there; it also says what else may load on a click (`ask`). Every design component
 * that loads an image, video or audio takes a `MediaSrc`, and only this module makes one, so a URL can't reach
 * one without being asked about. `$lib/protocol/sanitize` asks the same gate of
 * every media URL in the HTML it lets through.
 */
import type { MediaSrc } from '$lib/design/components/types';
import { embedMedia, safeLink, sameOriginMedia } from '$lib/protocol/embeds';
import { blockableHost, parseMediaOrigins } from './media-settings.svelte';

export type { MediaSrc };

export interface MediaGate {
	/** What it lets through, in words a cache can be keyed by: it changes whenever that does. */
	readonly key: string;
	/** `value` as media to load, where it may load from; else undefined. */
	src(value: unknown): MediaSrc | undefined;
	/** `value`, media that may not load but may on a click (Load, or Always load or Block its site); else undefined. */
	ask(value: unknown): MediaAsk | undefined;
}

/** Media that waits for a click: where it is, its site, and its origin when that can be trusted or blocked from now on (`https:`). */
export interface MediaAsk {
	url: string;
	host: string;
	origin?: string;
}

export interface MediaGateOptions {
	/** From anywhere but the server itself, only `https:` loads, as for avatars (§4.8.6). */
	httpsElsewhere?: boolean;
	/** URLs the viewer clicked to load, which load wherever they are. */
	once?: readonly string[];
	/** Media from anywhere else may be asked for (`ask`), rather than never loading. */
	asks?: boolean;
	/**
	 * Origins whose media never loads, nor is asked for: Preferences' Blocked origins. They win over everything else
	 * that would let media load (the trusted origins, Any site, a click on Load), and match by host (`blockableHost`),
	 * whatever the scheme or port, and every host under it (blocking `tracker.example` blocks `a.tracker.example`).
	 */
	blocked?: readonly string[];
}

/** The host of `url` to compare a blocked one with (`blockableHost`); else undefined. */
function hostOf(url: string): string | undefined {
	try {
		return blockableHost(new URL(url));
	} catch {
		return undefined;
	}
}

/** A gate for the chat server at `origin` and the origins trusted besides it (`embedMedia`). */
export function mediaGate(origin: string | undefined, trusted: readonly string[], options: MediaGateOptions = {}): MediaGate {
	const once = options.once ?? [];
	const blocked = new Set((options.blocked ?? []).flatMap((entry) => hostOf(entry) ?? []));
	const key = `${origin ?? ''} ${trusted.join(' ')}${options.httpsElsewhere ? ' https' : ''}${options.asks ? ' ask' : ''}${blocked.size ? ` -${[...blocked].join(' -')}` : ''}${once.length ? `\n${once.join('\n')}` : ''}`;
	const isBlocked = (value: unknown): boolean => {
		const link = blocked.size ? safeLink(value) : undefined;
		if (link === undefined) return false;
		// The host, then each one it is under: a.b.example, b.example, example.
		for (let host = blockableHost(new URL(link)); host; host = host.slice(host.indexOf('.') + 1) || '') {
			if (blocked.has(host)) return true;
			if (!host.includes('.')) break;
		}
		return false;
	};
	const src = (value: unknown): MediaSrc | undefined => {
		if (isBlocked(value)) return undefined;
		const url = embedMedia(value, origin, trusted);
		if (url === undefined) {
			const link = safeLink(value);
			return link && once.includes(link) ? (link as MediaSrc) : undefined;
		}
		if (options.httpsElsewhere && url.startsWith('http:') && !sameOriginMedia(value, origin) && !trusted.includes(new URL(url).origin)) return undefined;
		return url as MediaSrc;
	};
	return {
		key,
		src,
		ask(value) {
			if (!options.asks || isBlocked(value) || src(value) !== undefined) return undefined;
			const url = safeLink(value);
			if (!url) return undefined;
			const [trustable] = parseMediaOrigins(url);
			return { url, host: new URL(url).host, ...(trustable ? { origin: trustable } : {}) };
		}
	};
}

/** Lets nothing through but small inline images (`data:`): where nothing is known of where media may load from. */
export const NO_MEDIA: MediaGate = mediaGate(undefined, []);

/**
 * A file of the viewer's own, made into a URL here (`URL.createObjectURL`), such as an attachment not yet sent:
 * it loads from this device, so it tells no one anything. Anything else isn't one.
 */
export function localMedia(url: string | undefined): MediaSrc | undefined {
	return url?.startsWith('blob:') && url.slice(5).startsWith(`${globalThis.location?.origin}/`) ? (url as MediaSrc) : undefined;
}
