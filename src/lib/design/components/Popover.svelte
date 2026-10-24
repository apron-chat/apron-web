<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import type { PopoverPlacement } from './types';

	/**
	 * A popover fixed to the viewport, so nothing that scrolls or clips can cut
	 * it off: beside what opened it on wide screens, a bottom sheet on narrow
	 * ones. You place it (`mode`, `top`, `left`, `width`) and close it; it is
	 * the shell of ProfileCard, ReactorsPopover and EmojiPopover. Its `<div>`
	 * is a focusable dialog, named by `label`.
	 */
	interface Props extends PopoverPlacement {
		/** Names the dialog (its `aria-label`). */
		label: string;
		/** Classes for its `<div>`, added to its own. */
		class?: ClassValue;
		/** A `data-testid` for its `<div>`. */
		testid?: string;
		/** A `data-state` for its `<div>`, such as whether what it holds has loaded. */
		state?: string;
		/** Keys in it, such as Escape to close it; `onkeydowncapture` sees them before what has focus does. */
		onkeydown?: (event: KeyboardEvent) => void;
		onkeydowncapture?: (event: KeyboardEvent) => void;
		/** Focus leaving something in it, such as to close it when focus leaves it altogether. */
		onfocusout?: (event: FocusEvent) => void;
		/** Its `<div>`, bindable: move focus into it, and tell a press inside from one outside. */
		element?: HTMLDivElement;
		/** Its rendered height in px, bindable, to place it by before it fits. */
		offsetHeight?: number;
		children: Snippet;
	}
	let { mode = 'popover', top, left, width, height, label, class: className, testid, state, onkeydown, onkeydowncapture, onfocusout, element = $bindable(), offsetHeight = $bindable(0), children }: Props = $props();
	const popover = $derived(mode === 'popover');
	/** Its placement. */
	const px = (name: string, value: number | undefined) => value !== undefined && `${name}: ${value}px`;
	const style = $derived([popover && px('top', top), popover && px('left', left), popover && px('width', width), px('height', height)].filter(Boolean).join('; ') || undefined);
</script>

<div
	role="dialog"
	tabindex="-1"
	aria-label={label}
	data-testid={testid}
	data-state={state}
	class={['ap-popover', mode === 'sheet' && 'ap-popover-sheet', className]}
	{style}
	{onkeydown}
	{onkeydowncapture}
	{onfocusout}
	bind:this={element}
	bind:offsetHeight
>
	{@render children()}
</div>
