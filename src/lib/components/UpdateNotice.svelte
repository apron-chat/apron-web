<script lang="ts">
	import { onMount } from 'svelte';
	import { updated } from '$app/state';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import ActionBanner from '$lib/design/components/ActionBanner.svelte';
	import Button from '$lib/design/components/Button.svelte';
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
	<ActionBanner float title="Apron has been updated" detail={unsent ? 'Reloading clears your unsent message.' : undefined}>
		{#snippet icon()}<RefreshCw size={16} aria-hidden="true" />{/snippet}
		{#snippet action()}
			<Button size="sm" variant="ghost" onclick={() => (dismissed = true)} label="Later" />
			<Button size="sm" variant="primary" onclick={() => location.reload()} label="Reload" />
		{/snippet}
	</ActionBanner>
{/if}
