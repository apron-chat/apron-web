import type { MediaSrc } from '$lib/design/components/types';

/** A URL as a component takes one to load (`MediaSrc`), for tests: the app's own come only from `$lib/ui/media-gate`. */
export function media(url: string): MediaSrc {
	return url as MediaSrc;
}
