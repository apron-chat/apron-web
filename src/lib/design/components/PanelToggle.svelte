<script lang="ts">
	import PanelLeft from '@lucide/svelte/icons/panel-left';
	import PanelRight from '@lucide/svelte/icons/panel-right';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import { chain } from './util';

	/**
	 * A part of AppShell, as its `sideToggle` or `membersToggle`. Other attributes go on the button, the caller's
	 * winning: its class is added, and its `onclick` runs before `ontoggle` (`preventDefault()` skips `ontoggle`).
	 */
	interface Props extends HTMLButtonAttributes {
		/** The window's corner it sits in: top left for the rooms list, top right for the member list. */
		side: 'left' | 'right';
		/** What it shows and hides, as the label says it: "rooms", "member list". */
		panel: string;
		/** Whether the panel is showing. */
		open: boolean;
		ontoggle?: () => void;
	}
	let { side, panel, open, ontoggle, class: className, onclick, ...rest }: Props = $props();

	let button = $state<HTMLButtonElement | undefined>();
	const label = $derived(`${open ? 'Hide' : 'Show'} ${panel}`);

	/** Where focus goes when its panel collapses from under it, such as by dragging its border shut. */
	export function focus(): void {
		button?.focus();
	}
</script>

<!--
	In the window's top corner, over the header beside it: the panel's own while it's open, the conversation's once
	it's shut. It stays put while its panel slides, so the same spot opens and shuts it.
-->
<button bind:this={button} type="button" aria-label={label} title={label} aria-expanded={open} {...rest} class={['ap-iconbtn', 'ap-shell-toggle', `ap-shell-toggle-${side}`, className]} onclick={chain(ontoggle, onclick)}>
	{#if side === 'left'}<PanelLeft size={18} strokeWidth={1.8} aria-hidden="true" />{:else}<PanelRight size={18} strokeWidth={1.8} aria-hidden="true" />{/if}
</button>
