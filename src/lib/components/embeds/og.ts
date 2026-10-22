import type { OG } from '$lib/design/components/types';
import { embedMedia } from '$lib/protocol/embeds';
import type { OpenGraph, OpenGraphMedia } from '$lib/protocol/types';

/**
 * An embed's `og` with only the media this client may load (`embedMedia`:
 * the chat server's own files and trusted origins). Media from anywhere else
 * keeps its size, which still shapes the box, but loses its address.
 */
export function loadableOg(og: OpenGraph | undefined, origin: string | undefined): OG {
	const media = (item: OpenGraphMedia | undefined) => item && { ...item, url: embedMedia(item.url, origin) ?? '' };
	return { ...og, image: media(og?.image), video: media(og?.video), audio: media(og?.audio) };
}
