<script lang="ts">
	import { onMount } from 'svelte';
	import { updated } from '$app/state';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import ActionBanner from '$lib/design/components/ActionBanner.svelte';
	import { pageDrafts } from '$lib/ui/pane-drafts.svelte';

	/**
	 * Offers a reload once a newer deploy is out: SvelteKit polls for it
	 * (`version.pollInterval`), and a lazily loaded chunk the deploy removed
	 * means this tab is stale too. It never reloads by itself, and drafts live
	 * only in memory, so it says when reloading would clear one.
	 */
	let chunkMissing = $state(false);
	let dismissed = $state(false);
	let unsent = $derived(pageDrafts.current?.unsent ?? false);

	onMount(() => {
		const stale = () => (chunkMissing = true);
		window.addEventListener('vite:preloadError', stale);
		return () => window.removeEventListener('vite:preloadError', stale);
	});
</script>

{#if (updated.current || chunkMissing) && !dismissed}
	<div class="update">
		<ActionBanner title="Apron has been updated" detail={unsent ? 'Reloading clears your unsent message.' : undefined} testid="update-notice">
			{#snippet icon()}<RefreshCw size={16} aria-hidden="true" />{/snippet}
			{#snippet action()}
				<button class="ap-btn ap-btn-sm ap-btn-ghost" type="button" onclick={() => (dismissed = true)}>Later</button>
				<button class="ap-btn ap-btn-sm ap-btn-primary" type="button" data-testid="update-reload" onclick={() => location.reload()}>Reload</button>
			{/snippet}
		</ActionBanner>
	</div>
{/if}

<style>
	.update { position: fixed; z-index: 20; top: var(--space-4); left: 50%; transform: translateX(-50%); width: max-content; max-width: min(480px, calc(100% - var(--space-8))); }
	@media (max-width: 719px) {
		.update { left: var(--space-4); right: var(--space-4); transform: none; width: auto; max-width: none; }
	}
</style>
