<script lang="ts">
	import { keepSettingsInMemory } from '$lib/ui/storage';
	import AppPage from '../+page.svelte';

	let { data } = $props();

	// Before the app mounts, so nothing it saves while previewing replaces the real settings.
	keepSettingsInMemory();
</script>

<svelte:head><meta name="robots" content="noindex" /></svelte:head>

<AppPage webSocketFactory={data.webSocketFactory} />
