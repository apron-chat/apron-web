<script lang="ts">
	/*
	 * The (x) on an embed's corner, such as to take a link preview off a draft or an embed off a sent message. Place it
	 * inside a positioned slot beside the embed: it shows while the slot is hovered or it has focus, and always on
	 * touch screens.
	 */
	import X from '@lucide/svelte/icons/x';

	interface Props {
		/** What it takes off, for its tooltip and screen readers, such as "Remove preview". */
		label: string;
		onremove?: () => void;
	}
	let { label, onremove }: Props = $props();
</script>

<button class="ap-embed-remove" type="button" aria-label={label} title={label} onclick={onremove}>
	<X size={12} strokeWidth={2.5} aria-hidden="true" />
</button>
