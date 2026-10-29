<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import FoldHeading from './FoldHeading.svelte';

	/**
	 * A group of rows in the sidebar under a FoldHeading: folded, the caller shows only the rows with news, and the
	 * heading's … shows them all again.
	 */
	interface Props {
		/** Its heading. */
		title: string;
		/** Folded to the rows with news, which the caller picks out: `children` shows those alone. `bind:folded` works too. */
		folded?: boolean;
		onfold?: (folded: boolean) => void;
		/** Off: the title is a plain heading, and the section never folds. */
		foldable?: boolean;
		/** A + at the end of the heading, such as Create room; `addLabel` is its name and tooltip. */
		onadd?: () => void;
		addLabel?: string;
		/** While the list is loading: placeholder lines in place of `children`. */
		loading?: boolean;
		/** A `data-testid` for the heading that folds, one for its …, and one for the body. */
		toggleTestid?: string;
		expandTestid?: string;
		bodyTestid?: string;
		children?: Snippet;
		/** Classes for its `<section>`, added to its own. */
		class?: ClassValue;
	}
	let { title, folded = $bindable(false), onfold, foldable = true, onadd, addLabel, loading, toggleTestid, expandTestid, bodyTestid, children, class: className }: Props = $props();
</script>

{#snippet add()}
	<button type="button" class="ap-btn ap-btn-ghost ap-btn-sm ap-sect-add" aria-label={addLabel} title={addLabel} onclick={onadd}><Plus size={18} aria-hidden="true" /></button>
{/snippet}

<section class={['ap-sect', className]}>
	{#if foldable}
		<FoldHeading class="ap-sect-head" label={title} bind:folded {onfold} end={onadd ? add : undefined} {toggleTestid} {expandTestid} />
	{:else}
		<div class="ap-foldhead ap-sect-head">
			<span class="ap-sect-toggle" role="heading" aria-level="2">{title}</span>
			{#if onadd}<span class="ap-foldhead-ends">{@render add()}</span>{/if}
		</div>
	{/if}
	<div class="ap-sect-body" data-testid={bodyTestid}>
		{#if loading}
			<div class="ap-sect-skel" aria-hidden="true"><span class="ap-skel" style:width="70%"></span><span class="ap-skel" style:width="52%"></span><span class="ap-skel" style:width="61%"></span></div>
		{:else}
			{@render children?.()}
		{/if}
	</div>
</section>
