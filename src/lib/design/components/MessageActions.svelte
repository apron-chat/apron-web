<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import type { MessageAction } from './types';

	/** Other attributes (`data-*`, `class`) go on the toolbar. */
	interface Props extends HTMLAttributes<HTMLDivElement> {
		items: MessageAction[];
		onmore?: () => void;
	}
	let { items, onmore, class: className, ...rest }: Props = $props();
	const shown = $derived(items.filter((it) => it && !it.hidden));
</script>

<div role="toolbar" aria-label="Message actions" {...rest} class={['ap-actions', className]}>
	{#each shown as it (it.id || it.label)}
		<button type="button" class={['ap-actions-btn', it.danger && 'ap-actions-danger']} onclick={it.onclick} title={it.label} aria-label={it.label}>{it.glyph || it.label}</button>
	{/each}
	{#if onmore}<button type="button" class="ap-actions-btn" onclick={onmore} aria-label="More actions" title="More">⋯</button>{/if}
</div>
