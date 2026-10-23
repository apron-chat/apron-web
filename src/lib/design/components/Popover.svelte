<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import type { PopoverPlacement } from './types';

	/**
	 * A popover fixed to the viewport, so nothing that scrolls or clips can cut
	 * it off: beside what opened it on wide screens, a bottom sheet on narrow
	 * ones. You place it (`mode`, `top`, `left`, `width`) and close it; it is
	 * the shell of ProfileCard, ReactorsPopover and EmojiPopover. Other
	 * attributes (`aria-label`, `data-*`, event handlers, `class`, `style`) go
	 * on its `<div>`, a focusable dialog: yours win, and classes and styles
	 * merge (yours after its placement).
	 */
	interface Props extends HTMLAttributes<HTMLDivElement>, PopoverPlacement {
		/** Its `<div>`, bindable: move focus into it, and tell a press inside from one outside. */
		element?: HTMLDivElement;
		/** Its rendered height in px, bindable, to place it by before it fits. */
		offsetHeight?: number;
		children: Snippet;
	}
	let { mode = 'popover', top, left, width, height, element = $bindable(), offsetHeight = $bindable(0), class: className, style: styleAttr, children, ...rest }: Props = $props();
	const popover = $derived(mode === 'popover');
	/** Its placement, then any style of yours. */
	const px = (name: string, value: number | undefined) => value !== undefined && `${name}: ${value}px`;
	const style = $derived([popover && px('top', top), popover && px('left', left), popover && px('width', width), px('height', height), styleAttr].filter(Boolean).join('; ') || undefined);
</script>

<div
	role="dialog"
	tabindex="-1"
	{...rest}
	class={['ap-popover', mode === 'sheet' && 'ap-popover-sheet', className]}
	{style}
	bind:this={element}
	bind:offsetHeight
>
	{@render children()}
</div>
