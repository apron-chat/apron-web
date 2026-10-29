<script lang="ts">
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Plus from '@lucide/svelte/icons/plus';
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';

	/**
	 * A group of rows in the sidebar under a heading that folds it, as picking the open room folds its threads: folded,
	 * the caller shows only the rows with news, and a "…" pill before the heading's + says the list is cut short and
	 * shows it all again, as does the heading.
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
		/** A `data-testid` for the heading that folds, one for the …, and one for the body. */
		toggleTestid?: string;
		expandTestid?: string;
		bodyTestid?: string;
		children?: Snippet;
		/** Classes for its `<section>`, added to its own. */
		class?: ClassValue;
	}
	let { title, folded = $bindable(false), onfold, foldable = true, onadd, addLabel, loading, toggleTestid, expandTestid, bodyTestid, children, class: className }: Props = $props();
	let heading = $state<HTMLButtonElement | undefined>();

	function fold(next: boolean): void {
		folded = next;
		onfold?.(next);
	}

	/** The … goes once it has unfolded the section: keyboard focus moves to the heading rather than dropping to the page. */
	function expand(): void {
		heading?.focus();
		fold(false);
	}
</script>

<section class={['ap-sect', folded && 'ap-sect-folded', className]}>
	<div class="ap-sect-head">
		{#if foldable}
			<button type="button" class="ap-sect-toggle" bind:this={heading} aria-expanded={!folded} data-testid={toggleTestid} onclick={() => fold(!folded)}>{title}</button>
		{:else}
			<span class="ap-sect-toggle" role="heading" aria-level="2">{title}</span>
		{/if}
		{#if (foldable && folded) || onadd}
			<span class="ap-sect-ends">
				{#if foldable && folded}<button type="button" class="ap-sect-expand" data-testid={expandTestid} aria-label="Show all {title}" title="Show all" onclick={expand}><Ellipsis size={14} aria-hidden="true" /></button>{/if}
				{#if onadd}<button type="button" class="ap-btn ap-btn-ghost ap-btn-sm ap-sect-add" aria-label={addLabel} title={addLabel} onclick={onadd}><Plus size={18} aria-hidden="true" /></button>{/if}
			</span>
		{/if}
	</div>
	<div class="ap-sect-body" data-testid={bodyTestid}>
		{#if loading}
			<div class="ap-sect-skel" aria-hidden="true"><span class="ap-skel" style:width="70%"></span><span class="ap-skel" style:width="52%"></span><span class="ap-skel" style:width="61%"></span></div>
		{:else}
			{@render children?.()}
		{/if}
	</div>
</section>
