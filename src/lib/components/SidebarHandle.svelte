<script lang="ts">
	import PanelLeftClose from '@lucide/svelte/icons/panel-left-close';
	import PanelLeftOpen from '@lucide/svelte/icons/panel-left-open';
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
		/** Show the compact toggle that remains visible when the panel collapses. */
		showToggle?: boolean;
		/** Collapsed from the keyboard, where the handle may go with the panel: a place to move focus to. */
		oncollapse?: () => void;
	}
	let { layout, name = 'sidebar', showToggle = false, oncollapse }: Props = $props();

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
	aria-label={layout.collapsed ? `Resize or expand ${name}` : `Resize ${name}; use Left and Right Arrow keys to adjust width, Enter or Space to collapse`}
	aria-keyshortcuts="ArrowLeft ArrowRight Enter Space"
	aria-expanded={!layout.collapsed}
	title={layout.collapsed ? `Resize or expand ${name}` : 'Drag to resize; click, Enter, or Space to collapse'}
	onpointerdown={(event) => layout.startResize(event)}
	onclick={(event) => { if (event.detail === 0) keyToggle(); }}
	onkeydown={(event) => layout.handleKey(event)}
></button>

{#if showToggle}
	<button
		class="toggle"
		class:collapsed={layout.collapsed}
		class:resizing={layout.resizing}
		type="button"
		aria-label={layout.collapsed ? `Expand ${name}` : `Collapse ${name}`}
		aria-expanded={!layout.collapsed}
		title={layout.collapsed ? `Expand ${name}` : `Collapse ${name}`}
		onclick={() => layout.toggle()}
	>
		<span class="toggle-surface">
			<span class="toggle-icons" aria-hidden="true">
				<PanelLeftClose size={18} strokeWidth={1.8} />
				<PanelLeftOpen size={18} strokeWidth={1.8} />
			</span>
		</span>
	</button>
{/if}

<style>
	.handle { position: absolute; top: 0; bottom: 0; left: calc(var(--sidebar-w) - 4px); width: 9px; margin: 0; padding: 0; border: 0; border-radius: 0; background: transparent; z-index: 4; cursor: col-resize; touch-action: none; }
	.handle::after { content: ''; position: absolute; top: 0; bottom: 0; left: 4px; width: 1px; background: var(--line); }
	.handle:hover::after, .handle:focus-visible::after, .resizing::after { left: 3px; width: 3px; background: var(--denim); }
	.handle:focus-visible { outline: none; }
	.handle.collapsed { left: 0; cursor: e-resize; }
	.handle.collapsed::after { left: 0; }
	.right { left: auto; right: calc(var(--member-list-w) - 9px); }
	.right::after, .right:hover::after, .right:focus-visible::after, .right.resizing::after { left: 0; }
	.right.collapsed { right: 0; }
	.toggle { position: absolute; top: 0; left: max(0px, calc(var(--sidebar-w) - var(--sidebar-toggle-w))); width: var(--sidebar-toggle-w); height: var(--header-h); margin: 0; padding: 0; border: 0; background: transparent; color: var(--ink-muted); z-index: 5; cursor: pointer; }
	.toggle-surface { display: grid; place-items: center; width: 100%; height: 100%; border-bottom: 1px solid var(--line); border-radius: 0; background: var(--bg-000); transition: background-color 140ms ease, color 140ms ease; }
	.toggle:hover .toggle-surface, .toggle:focus-visible .toggle-surface { background: var(--bg-300); color: var(--ink); }
	.toggle:focus-visible { outline: none; }
	.toggle:focus-visible .toggle-surface { outline: 2px solid var(--focus); outline-offset: -2px; }
	.toggle.collapsed { top: 0; height: var(--header-h); background: var(--bg-100); }
	.toggle.collapsed .toggle-surface { position: absolute; inset: 0; width: var(--sidebar-toggle-w); height: var(--header-h); border-right: 1px solid var(--line); background: var(--bg-100); }
	.toggle.collapsed:hover, .toggle.collapsed:focus-visible { background: var(--bg-300); color: var(--ink); }
	.toggle.collapsed:hover .toggle-surface, .toggle.collapsed:focus-visible .toggle-surface { background: var(--bg-300); color: var(--ink); }
	.toggle.resizing { transition: none; }
	.toggle-icons { position: relative; display: block; width: 18px; height: 18px; }
	.toggle-icons :global(svg) { position: absolute; inset: 0; transition: opacity 140ms ease, transform 180ms ease; }
	.toggle-icons :global(svg:last-child) { opacity: 0; transform: translateX(-4px); }
	.toggle.collapsed .toggle-icons :global(svg:first-child) { opacity: 0; transform: translateX(4px); }
	.toggle.collapsed .toggle-icons :global(svg:last-child) { opacity: 1; transform: none; }
	@media (max-width: 719px) {
		.handle, .toggle { display: none; }
	}
	@media (prefers-reduced-motion: reduce) {
		.toggle, .toggle-surface, .toggle-icons :global(svg) { transition: none; }
	}
</style>
