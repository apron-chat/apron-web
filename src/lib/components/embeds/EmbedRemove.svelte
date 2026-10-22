<script lang="ts">
	import DesignEmbedRemove from '$lib/design/components/EmbedRemove.svelte';
	/**
	 * The (x) on an embed's corner. Place it inside a positioned slot beside
	 * the embed: it shows while the slot is hovered or it has focus, and
	 * always on touch screens.
	 */
	let { label, onremove }: { label: string; onremove: () => void } = $props();
</script>

<DesignEmbedRemove {label} {onremove} />
