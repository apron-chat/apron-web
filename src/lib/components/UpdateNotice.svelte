<script lang="ts">
	import { onMount } from 'svelte';
	import { updated } from '$app/state';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import ActionBanner from '$lib/design/components/ActionBanner.svelte';
	import Button from '$lib/design/components/Button.svelte';
	import { pageDrafts } from '$lib/ui/pane-drafts.svelte';
	import { checkOnReturn } from '$lib/ui/update-poll';

	/**
	 * Offers a reload once a newer deploy is out: SvelteKit polls for it
	 * (`version.pollInterval`), at once too when the page comes back after
	 * a poll's worth of time away (`checkOnReturn`), and a lazily loaded chunk
	 * that failed to load has it check at once, for a deploy that removed the
	 * chunk means this tab is stale too. A dropped connection fails the same
	 * way but finds no newer deploy, so it isn't taken for one (the toast says
	 * the load failed). It never reloads by itself, and says when reloading
	 * would clear a draft: its files, which are never kept, or its text where drafts aren't kept on this device.
	 */
	let dismissed = $state(false);
	let unsent = $derived(pageDrafts.current?.unsent ?? false);

	onMount(() => {
		const stale = () => void updated.check();
		window.addEventListener('vite:preloadError', stale);
		// `check` also starts the poll's next wait over: no second request soon after.
		const stopChecking = checkOnReturn(() => {
			if (!updated.current) void updated.check();
		});
		return () => {
			window.removeEventListener('vite:preloadError', stale);
			stopChecking();
		};
	});
</script>

{#if updated.current && !dismissed}
	<ActionBanner float title="Apron has been updated" detail={unsent ? 'Reloading clears your unsent message.' : undefined}>
		{#snippet icon()}<RefreshCw size={16} aria-hidden="true" />{/snippet}
		{#snippet action()}
			<Button size="sm" variant="ghost" onclick={() => (dismissed = true)} label="Later" />
			<Button size="sm" variant="primary" onclick={() => location.reload()} label="Reload" />
		{/snippet}
	</ActionBanner>
{/if}
