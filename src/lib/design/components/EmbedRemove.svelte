<script lang="ts">
	/*
	 * The (x) on an embed's corner, such as to take a link preview off a draft or an embed off a sent message. Place it
	 * inside a positioned slot beside the embed: it shows while the slot is hovered or it has focus, and always on
	 * touch screens.
	 */
	import X from '@lucide/svelte/icons/x';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import { chain } from './util';

	/** Other attributes (`data-*`, a `class`) go on the button; an `onclick` of yours runs first, and `preventDefault()` there skips `onremove`. */
	interface Props extends HTMLButtonAttributes {
		/** What it takes off, for its tooltip and screen readers, such as "Remove preview". */
		label: string;
		onremove?: () => void;
	}
	let { label, onremove, class: className, onclick, ...rest }: Props = $props();
</script>

<button type="button" aria-label={label} title={label} {...rest} class={['ap-embed-remove', className]} onclick={chain(onremove, onclick)}>
	<X size={12} strokeWidth={2.5} aria-hidden="true" />
</button>
