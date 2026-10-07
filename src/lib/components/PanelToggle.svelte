<script lang="ts">
	import PanelLeft from '@lucide/svelte/icons/panel-left';
	import PanelRight from '@lucide/svelte/icons/panel-right';

	interface Props {
		/** The window's corner it sits in: top left for the rooms list, top right for the member list. */
		side: 'left' | 'right';
		/** What it shows and hides, as the label says it: "rooms", "member list". */
		panel: string;
		/** Whether the panel is showing. */
		open: boolean;
		ontoggle: () => void;
	}
	let { side, panel, open, ontoggle }: Props = $props();

	let button = $state<HTMLButtonElement | undefined>();
	let label = $derived(`${open ? 'Hide' : 'Show'} ${panel}`);

	/** Where focus goes when its panel collapses from under it, such as by dragging its border shut. */
	export function focus(): void {
		button?.focus();
	}
</script>

<!--
	In the window's top corner, over the header beside it: the panel's own while it's open, the conversation's once
	it's shut. It stays put while its panel slides, so the same spot opens and shuts it.
-->
<button bind:this={button} class={['ap-iconbtn', 'panel-toggle', side]} type="button" aria-label={label} title={label} aria-expanded={open} onclick={ontoggle}>
	{#if side === 'left'}<PanelLeft size={18} strokeWidth={1.8} aria-hidden="true" />{:else}<PanelRight size={18} strokeWidth={1.8} aria-hidden="true" />{/if}
</button>

<style>
	.panel-toggle { position: absolute; z-index: 5; top: calc((var(--header-h) - 28px) / 2); }
	.left { left: var(--space-3); }
	.right { right: var(--space-3); }
</style>
