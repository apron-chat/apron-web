import type { OG } from '$lib/design/components/types';
import { mayAnimate } from '$lib/ui/animation-settings.svelte';
import { askProps } from '$lib/ui/media-ask';
import type { MediaGate } from '$lib/ui/media-gate';
import type { OpenGraph, OpenGraphMedia } from '$lib/protocol/types';

/**
 * An embed's `og` with only the media this client may load (`gate`: the chat server's own files, the origins it
 * names for media, and as the viewer chose). Media from anywhere else keeps its size, which still shapes the box,
 * but loses its address; where a click may load it, it says so (`ask`). An image that may be animated says so
 * (`animated`, `mayAnimate`, from its type, else its URL or the file's `name`).
 */
export function loadableOg(og: OpenGraph | undefined, gate: MediaGate, name?: string): OG {
	const media = (item: OpenGraphMedia | undefined) => {
		if (!item) return undefined;
		const { url, ...rest } = item;
		const src = gate.src(url);
		if (src) return { ...rest, url: src };
		const ask = gate.ask(url);
		return ask ? { ...rest, ask: askProps(ask) } : rest;
	};
	const image = media(og?.image);
	return { ...og, image: image && mayAnimate(og?.image, name) ? { ...image, animated: true } : image, video: media(og?.video), audio: media(og?.audio) };
}
