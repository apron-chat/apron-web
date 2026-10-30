/**
 * The one way the app turns a URL into one a component loads as media (`MediaSrc`): a gate knows where media may
 * load from (the chat server's own origin, and the origins trusted besides it: those the server names with
 * `ext:media`, the sites the viewer added, or any, as Preferences' Media says) and lets through only URLs from
 * there. Every design component that loads an image, video or audio takes a `MediaSrc`, and only this module
 * makes one, so a URL can't reach one without being asked about. `$lib/protocol/sanitize` asks the same gate of
 * every media URL in the HTML it lets through.
 */
import type { MediaSrc } from '$lib/design/components/types';
import { embedMedia, sameOriginMedia } from '$lib/protocol/embeds';

export type { MediaSrc };

export interface MediaGate {
	/** What it lets through, in words a cache can be keyed by: it changes whenever that does. */
	readonly key: string;
	/** `value` as media to load, where it may load from; else undefined. */
	src(value: unknown): MediaSrc | undefined;
}

/**
 * A gate for the chat server at `origin` and the origins trusted besides it (`embedMedia`). `httpsElsewhere`: from
 * anywhere but the server itself only `https:` loads, as for avatars (§4.8.6).
 */
export function mediaGate(origin: string | undefined, trusted: readonly string[], options: { httpsElsewhere?: boolean } = {}): MediaGate {
	const key = `${origin ?? ''} ${trusted.join(' ')}${options.httpsElsewhere ? ' https' : ''}`;
	return {
		key,
		src(value) {
			const url = embedMedia(value, origin, trusted);
			if (url === undefined) return undefined;
			if (options.httpsElsewhere && url.startsWith('http:') && !sameOriginMedia(value, origin) && !trusted.includes(new URL(url).origin)) return undefined;
			return url as MediaSrc;
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
