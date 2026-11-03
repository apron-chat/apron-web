/*
 * The layout's overlays, loaded on demand in a chunk of their own (`overlays-lazy.ts` loads it): each draws nothing
 * until its state (eager) asks, and is rendered from then on (`Lazy.once`). Not in `on-demand.ts`: were the layout to
 * import that chunk too, the bundler could no longer count on the page having loaded what it shares with the page,
 * and would split that out into more chunks at startup. The terminal viewer stays in the layout for the same reason:
 * here, what it shares with the page (`$app/navigation`, the xterm loader) became a startup chunk of its own.
 */
export { default as EmojiPopover } from './EmojiPopover.svelte';
export { default as MediaViewerHost } from './MediaViewerHost.svelte';
