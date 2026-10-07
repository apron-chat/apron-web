<script lang="ts">
	import type { SidebarLayout } from '$lib/ui/sidebar.svelte';

	/**
	 * A side panel's inner border as a resize handle: the rooms list's right
	 * border, which sits in the main pane's column so a collapsed sidebar (0px)
	 * still leaves a border to grab, or the member list's left border, inside
	 * the list so it never covers the conversation's scrollbar (and so, once
	 * collapsed, the list reopens from the room header instead).
	 */
	interface Props {
		layout: SidebarLayout;
		name?: string;
		/** Collapsed from the keyboard, where the handle may go with the panel: a place to move focus to. */
		oncollapse?: () => void;
	}
	let { layout, name = 'sidebar', oncollapse }: Props = $props();

	/** Enter or Space (a click with no pointer) toggles; pointer clicks toggle in startResize. */
	function keyToggle(): void {
		layout.toggle();
		if (layout.collapsed) oncollapse?.();
	}
</script>

<button
	class="handle"
	class:right={layout.side === 'right'}
	class:collapsed={layout.collapsed}
	class:resizing={layout.resizing}
	type="button"
	aria-label={layout.collapsed ? `Expand ${name}` : `Collapse ${name}`}
	aria-expanded={!layout.collapsed}
	title={layout.collapsed ? `Expand ${name}` : 'Drag to resize, click to collapse'}
	onpointerdown={(event) => layout.startResize(event)}
	onclick={(event) => { if (event.detail === 0) keyToggle(); }}
	onkeydown={(event) => layout.handleKey(event)}
></button>

<style>
	/* Placed by --sidebar-w, so the border slides with the rooms list as it opens and shuts, and rests at the window's edge once collapsed. */
	.handle { position: absolute; top: 0; bottom: 0; left: max(0px, calc(var(--sidebar-w) - 4px)); width: 9px; margin: 0; padding: 0; border: 0; border-radius: 0; background: transparent; z-index: 4; cursor: col-resize; touch-action: none; }
	.handle::after { content: ''; position: absolute; top: 0; bottom: 0; left: min(4px, var(--sidebar-w)); width: 1px; background: var(--line); }
	.handle:hover::after, .handle:focus-visible::after, .resizing::after { left: 3px; width: 3px; background: var(--denim); }
	.handle:focus-visible { outline: none; }
	.collapsed { cursor: e-resize; }
	.right { left: auto; right: calc(var(--member-list-w) - 9px); }
	.right::after, .right:hover::after, .right:focus-visible::after, .right.resizing::after { left: 0; }
	.right.collapsed { right: 0; }
	@media (max-width: 719px) {
		.handle { display: none; }
	}
</style>
