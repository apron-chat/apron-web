<script lang="ts">
	import type { MessageAction } from './types';
	import { cx } from './util';

	let { items, onmore }: { items: MessageAction[]; onmore?: () => void } = $props();
	const shown = $derived((items || []).filter((it) => it && !it.hidden));
</script>

<div class="ap-actions" role="toolbar" aria-label="Message actions">
	{#each shown as it (it.id || it.label)}
		<button type="button" class={cx('ap-actions-btn', it.danger && 'ap-actions-danger')} onclick={it.onclick} title={it.label} aria-label={it.label}>{it.glyph || it.label}</button>
	{/each}
	{#if onmore}<button type="button" class="ap-actions-btn" onclick={onmore} aria-label="More actions" title="More">⋯</button>{/if}
</div>
