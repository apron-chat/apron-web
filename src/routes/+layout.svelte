<script lang="ts">
	import { onMount } from 'svelte';
	import { appearanceSettings } from '$lib/ui/appearance.svelte';
	import '$lib/design/tokens.css';
	import '$lib/design/apron.css';
	import favicon from '$lib/assets/favicon.svg';
	import EmojiPopover from '$lib/components/EmojiPopover.svelte';
	import UpdateNotice from '$lib/components/UpdateNotice.svelte';

	let { children } = $props();

	onMount(() => appearanceSettings.load());
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
<!-- The one full emoji picker, outside the shell so nothing in it clips the popover. -->
<EmojiPopover />
<UpdateNotice />
