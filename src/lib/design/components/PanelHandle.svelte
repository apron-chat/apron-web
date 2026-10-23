<script lang="ts">
	import type { ClassValue } from 'svelte/elements';

	/**
	 * A part of AppShell, as its `sideHandle` or `membersHandle`: a side panel's inner border as a resize handle. The
	 * rooms list's right border, which sits in the main pane's column so a collapsed list (0px) still leaves a border
	 * to grab, or the member list's left border, inside the list so it never covers the conversation's scrollbar (and
	 * so, once collapsed, the list reopens from its corner toggle instead). Under 720px there is none.
	 */
	interface Props {
		side: 'left' | 'right';
		/** What it resizes, as its label says it: "sidebar", "member list". */
		name?: string;
		collapsed?: boolean;
		/** Being dragged: drawn as when pointed at, and it doesn't slide. */
		resizing?: boolean;
		/** A press: start a drag, and toggle the panel if it ends without moving. */
		onpointerdown?: (event: PointerEvent) => void;
		/** Arrow keys and the like, to resize from the keyboard. */
		onkeydown?: (event: KeyboardEvent) => void;
		/** Enter or Space, a click with no pointer: collapse or expand. */
		ontoggle?: () => void;
		/** Classes for the button, added to its own. */
		class?: ClassValue;
	}
	let { side, name = 'sidebar', collapsed = false, resizing = false, onpointerdown, onkeydown, ontoggle, class: className }: Props = $props();

	function keyToggle(event: MouseEvent): void {
		if (event.detail === 0) ontoggle?.();
	}
</script>

<button
	type="button"
	aria-label={collapsed ? `Expand ${name}` : `Collapse ${name}`}
	aria-expanded={!collapsed}
	title={collapsed ? `Expand ${name}` : 'Drag to resize, click to collapse'}
	class={['ap-shell-handle', side === 'right' && 'ap-shell-handle-right', collapsed && 'ap-shell-handle-shut', resizing && 'ap-shell-handle-resizing', className]}
	{onpointerdown}
	{onkeydown}
	onclick={keyToggle}
></button>
