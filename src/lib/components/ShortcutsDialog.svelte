<script lang="ts">
	import KeyboardShortcuts from '$lib/design/components/KeyboardShortcuts.svelte';
	import { shortcutGroups } from '$lib/ui/shortcuts';

	/** The keyboard shortcuts (`?`, or Ctrl+/), as this platform writes their keys. */
	interface Props {
		onclose: () => void;
	}
	let { onclose }: Props = $props();

	let open = $state(true);
	const mac = /Mac/.test(globalThis.navigator?.platform ?? '');
	const groups = shortcutGroups(mac);
</script>

<KeyboardShortcuts bind:open {groups} subtitle="Press ? to show these again." {onclose} />
