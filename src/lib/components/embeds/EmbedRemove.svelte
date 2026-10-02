<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	/**
	 * The (x) on an embed's corner. Place it inside a positioned slot beside
	 * the embed: it shows while the slot is hovered or it has focus, and
	 * always on touch screens.
	 */
	let { label, onremove }: { label: string; onremove: () => void } = $props();
</script>

<button class="ap-embed-remove" type="button" aria-label={label} title={label} onclick={onremove}>
	<X size={12} strokeWidth={2.5} aria-hidden="true" />
</button>
