<script lang="ts">
	import PanelLeft from '@lucide/svelte/icons/panel-left';
	import PanelRight from '@lucide/svelte/icons/panel-right';
	import type { ClassValue } from 'svelte/elements';

	/** A part of AppShell, as its `sideToggle` or `membersToggle`. */
	interface Props {
		/** Its panel's side: left for the rooms list, right for the member list (mirrored under `dir="rtl"`). */
		side: 'left' | 'right';
		/** What it shows and hides, as the label says it: "rooms", "member list". */
		panel: string;
		/** Whether the panel is showing. */
		open: boolean;
		ontoggle?: () => void;
		/** Classes for the button, added to its own. */
		class?: ClassValue;
	}
	let { side, panel, open, ontoggle, class: className }: Props = $props();

	let button = $state<HTMLButtonElement | undefined>();
	const label = $derived(`${open ? 'Hide' : 'Show'} ${panel}`);

	/** Where focus goes when its panel collapses from under it, such as by dragging its border shut. */
	export function focus(): void {
		button?.focus();
	}
</script>

<!--
	At its panel's inner edge, over a header: the panel's own while it's open (after the rooms list's server, before the
	member list's Members), the conversation's once it's shut (at the edge the panel shut against). It rides the border as
	the panel slides, so it's always beside the edge it moves.
-->
<button bind:this={button} type="button" aria-label={label} title={label} aria-expanded={open} class={['ap-iconbtn', 'ap-shell-toggle', `ap-shell-toggle-${side}`, className]} onclick={ontoggle}>
	{#if side === 'left'}<PanelLeft size={18} strokeWidth={1.8} aria-hidden="true" />{:else}<PanelRight size={18} strokeWidth={1.8} aria-hidden="true" />{/if}
</button>
