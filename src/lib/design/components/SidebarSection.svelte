<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	/** Other attributes (`data-testid`, `data-*`) go on its `<section>`, the caller's winning and its class added. */
	interface Props extends Omit<HTMLAttributes<HTMLElement>, 'ontoggle'> {
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
		action?: Snippet;
		/** While the list is loading: placeholder lines in place of `children`. */
		loading?: boolean;
		/** A `data-testid` for the folding title, and one for the body. */
		toggleTestid?: string;
		bodyTestid?: string;
		children?: Snippet;
	}
	let { title, open = $bindable(true), ontoggle, collapsible = true, onadd, addLabel, action, loading, toggleTestid, bodyTestid, children, class: className, ...rest }: Props = $props();
	function toggle() {
		open = !open;
		ontoggle?.(open);
	}
</script>

<section {...rest} class={['ap-sect', !open && 'ap-sect-closed', className]}>
	<div class="ap-sect-head">
		{#if collapsible}
			<button type="button" class="ap-sect-toggle" aria-expanded={open} data-testid={toggleTestid} onclick={toggle}><span class="ap-sect-caret" aria-hidden="true">▾</span>{title}</button>
		{:else}
			<span class="ap-sect-toggle" role="heading" aria-level="2">{title}</span>
		{/if}
		{#if onadd}
			<button type="button" class="ap-btn ap-btn-ghost ap-btn-sm ap-sect-add" aria-label={addLabel} title={addLabel} onclick={onadd}><Plus size={18} aria-hidden="true" /></button>
		{/if}
		{@render action?.()}
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
