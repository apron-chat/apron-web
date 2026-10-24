<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';

	interface Props {
		/** Its heading. */
		title: string;
		/** Controlled; omit to let the section keep its own state. `bind:open` works too. */
		open?: boolean;
		ontoggle?: (open: boolean) => void;
		/** Off: the title is a plain heading that doesn't fold, and the section is always open. */
		collapsible?: boolean;
		/** A + at the end of the heading, such as Create room; `addLabel` is its name and tooltip. */
		onadd?: () => void;
		addLabel?: string;
		/** While the list is loading: placeholder lines in place of `children`. */
		loading?: boolean;
		/** A `data-testid` for the folding title, and one for the body. */
		toggleTestid?: string;
		bodyTestid?: string;
		children?: Snippet;
		/** Classes for its `<section>`, added to its own. */
		class?: ClassValue;
	}
	let { title, open = $bindable(true), ontoggle, collapsible = true, onadd, addLabel, loading, toggleTestid, bodyTestid, children, class: className }: Props = $props();
	function toggle() {
		open = !open;
		ontoggle?.(open);
	}
</script>

<section class={['ap-sect', !open && 'ap-sect-closed', className]}>
	<div class="ap-sect-head">
		{#if collapsible}
			<button type="button" class="ap-sect-toggle" aria-expanded={open} data-testid={toggleTestid} onclick={toggle}><span class="ap-sect-caret" aria-hidden="true">▾</span>{title}</button>
		{:else}
			<span class="ap-sect-toggle" role="heading" aria-level="2">{title}</span>
		{/if}
		{#if onadd}
			<button type="button" class="ap-btn ap-btn-ghost ap-btn-sm ap-sect-add" aria-label={addLabel} title={addLabel} onclick={onadd}><Plus size={18} aria-hidden="true" /></button>
		{/if}
	</div>
	{#if open || !collapsible}
		<div class="ap-sect-body" data-testid={bodyTestid}>
			{#if loading}
				<div class="ap-sect-skel" aria-hidden="true"><span class="ap-skel" style:width="70%"></span><span class="ap-skel" style:width="52%"></span><span class="ap-skel" style:width="61%"></span></div>
			{:else}
				{@render children?.()}
			{/if}
		</div>
	{/if}
</section>
