/**
 * The full-screen image viewer: one at a time, opened by a plain click on an
 * image embed. It pages through every image in the same timeline, oldest
 * first, read from the links that open it (`data-viewer-*`), so it needs no
 * list of its own. `MediaViewerHost` (mounted once, in the page) draws it.
 */
import type { MediaItem } from '$lib/design/components/types';

/** What a link that opens the viewer says about its image. */
export function mediaItemOf(link: HTMLElement): MediaItem | undefined {
	const { viewerSrc: src, viewerTitle: title, viewerAlt: alt, viewerDetail: detail, viewerWidth: width, viewerHeight: height } = link.dataset;
	if (!src || !title) return undefined;
	const href = link instanceof HTMLAnchorElement ? link.href : undefined;
	return {
		src, title,
		...(alt ? { alt } : {}),
		...(detail ? { detail } : {}),
		...(href ? { href } : {}),
		...(Number(width) > 0 && Number(height) > 0 ? { width: Number(width), height: Number(height) } : {})
	};
}

/** The images to page through from `link`: every viewable one in its timeline (or the page), in order, and where `link` is. */
export function gallery(link: HTMLElement): { items: MediaItem[]; index: number; links: HTMLElement[] } {
	const scope = link.closest('.ap-timeline') ?? link.ownerDocument;
	const links: HTMLElement[] = [];
	const items: MediaItem[] = [];
	for (const candidate of scope.querySelectorAll<HTMLElement>('[data-viewer-src]')) {
		const item = mediaItemOf(candidate);
		if (!item) continue;
		links.push(candidate);
		items.push(item);
	}
	return { items, index: Math.max(0, links.indexOf(link)), links };
}

class MediaViewer {
	open = $state(false);
	items = $state.raw<MediaItem[]>([]);
	index = $state(0);
	private links: HTMLElement[] = [];

	/** Opens on `link`'s image. */
	show(link: HTMLElement): void {
		const found = gallery(link);
		if (!found.items.length) return;
		this.links = found.links;
		this.items = found.items;
		this.index = found.index;
		this.open = true;
	}

	/** It closed: focus goes back to the image last shown, where it still is, else the one that opened it. */
	closed(): void {
		this.open = false;
		const back = [this.links[this.index], ...this.links].find((link) => link?.isConnected);
		back?.focus({ preventScroll: false });
		this.links = [];
	}
}

export const mediaViewer = new MediaViewer();
