<script lang="ts">
	import { onMount } from 'svelte';
	import { updated } from '$app/state';
	import StatusBanner from './StatusBanner.svelte';

	/**
	 * Offers a reload once a newer deploy is out: SvelteKit polls for it
	 * (`version.pollInterval`), and a lazily loaded chunk the deploy removed
	 * means this tab is stale too. It never reloads by itself, so an unsent
	 * draft is only lost when you choose to.
	 */
	let chunkMissing = $state(false);
	let dismissed = $state(false);

	onMount(() => {
		const stale = () => (chunkMissing = true);
		window.addEventListener('vite:preloadError', stale);
		return () => window.removeEventListener('vite:preloadError', stale);
	});
</script>

{#if (updated.current || chunkMissing) && !dismissed}
	<div class="update" data-testid="update-notice">
		<StatusBanner tone="ok">
			New version available
			{#snippet action()}
				<button class="ap-btn ap-btn-sm ap-btn-ghost" type="button" onclick={() => (dismissed = true)}>Later</button>
				<button class="ap-btn ap-btn-sm ap-btn-primary" type="button" data-testid="update-reload" onclick={() => location.reload()}>Reload</button>
			{/snippet}
		</StatusBanner>
	</div>
{/if}

<style>
	.update { position: fixed; z-index: 20; top: var(--space-4); left: 50%; transform: translateX(-50%); max-width: min(480px, calc(100% - var(--space-8))); }
	.update :global(.ap-status) { box-shadow: var(--shadow-float); }
	@media (max-width: 719px) {
		.update { left: var(--space-4); right: var(--space-4); transform: none; max-width: none; }
	}
</style>
