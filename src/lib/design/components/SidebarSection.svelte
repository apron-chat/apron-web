<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		/** Controlled; omit to let the section keep its own state. `bind:open` works too. */
		open?: boolean;
		ontoggle?: (open: boolean) => void;
		action?: Snippet;
		children?: Snippet;
	}
	let { title, open = $bindable(true), ontoggle, action, children }: Props = $props();
	function toggle() {
		open = !open;
		ontoggle?.(open);
	}
</script>

<section class={['ap-sect', !open && 'ap-sect-closed']}>
	<div class="ap-sect-head">
		<button type="button" class="ap-sect-toggle" aria-expanded={open} onclick={toggle}><span class="ap-sect-caret" aria-hidden="true">▾</span>{title}</button>
		{@render action?.()}
	</div>
	{#if open}<div class="ap-sect-body">{@render children?.()}</div>{/if}
</section>
