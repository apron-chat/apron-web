<script lang="ts">
	import PanelHandle from '$lib/design/components/PanelHandle.svelte';
	import type { SidebarLayout } from '$lib/ui/sidebar.svelte';

	/**
	 * A side panel's inner border as a resize handle (the design system's
	 * PanelHandle), driving its SidebarLayout: a drag resizes it, a press
	 * without one collapses or expands it, and so do Enter and Space.
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

<PanelHandle side={layout.side} {name} collapsed={layout.collapsed} resizing={layout.resizing} onpointerdown={(event) => layout.startResize(event)} onkeydown={(event) => layout.handleKey(event)} ontoggle={keyToggle} />
