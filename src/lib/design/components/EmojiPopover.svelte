<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import Popover from './Popover.svelte';
	import type { PopoverPlacement } from './types';

	/**
	 * The full emoji picker's Popover. The picker itself is the client's (such
	 * as emoji-mart): put it into `mount`, or pass it as `children`. Give the
	 * Popover a `height`; the picker fills what the caption leaves. Other
	 * attributes (`data-*`, event handlers) go on the Popover.
	 */
	interface Props extends HTMLAttributes<HTMLDivElement>, PopoverPlacement {
		/** Which message a pick reacts to, in one line, as it may have scrolled away under the picker: `lead` ("Reacting to Ada") then the quoted `text`. */
		caption?: { lead: string; text: string };
		/** `loading` and `failed` say so over the picker's space. */
		status?: 'loading' | 'ready' | 'failed';
		/** The element the picker goes into, bindable. */
		mount?: HTMLDivElement;
		/** The picker, when it is a component. */
		children?: Snippet;
		/** The Popover's `<div>`, bindable. */
		element?: HTMLDivElement;
	}
	let { caption, status = 'ready', mount = $bindable(), children, element = $bindable(), class: className, ...rest }: Props = $props();
</script>

<Popover aria-label="Emoji picker" {...rest} class={['ap-emojipop', className]} bind:element>
	{#if caption}
		<p class="ap-emojipop-caption"><span class="ap-emojipop-lead">{caption.lead}</span> <span class="ap-emojipop-text">“{caption.text}”</span></p>
	{/if}
	{#if status !== 'ready'}
		<p class="ap-emojipop-status" role="status">{status === 'failed' ? 'Emoji couldn’t load. Close and try again.' : 'Loading emoji…'}</p>
	{/if}
	<!-- Left empty for a picker put into it, which replaces whatever it holds. -->
	{#if children}<div class="ap-emojipop-mount">{@render children()}</div>{:else}<div class="ap-emojipop-mount" bind:this={mount}></div>{/if}
</Popover>
