import { lazyChunk } from '$lib/ui/lazy.svelte';

/** The layout's overlays (`overlays.ts`), in one request: render each as `{#if host.once(Boolean(state.current))}`. */
const part = lazyChunk(() => import('./overlays'));

export const emojiPopover = part((m) => m.EmojiPopover);
export const mediaViewerHost = part((m) => m.MediaViewerHost);
