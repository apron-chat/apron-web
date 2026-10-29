<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import FoldPill from './FoldPill.svelte';

	/**
	 * A heading that folds its list, as picking the open room folds its threads: pressed, the list is folded to what has
	 * news (which rows those are is the caller's, and may be none), and a FoldPill at its end says it's cut short and
	 * shows it all again, as does the heading. A SidebarSection's, Other Threads', a member list's Online and Offline.
	 */
	interface Props {
		label: string;
		/** How many it lists: "Other Threads · 4". */
		count?: number;
		/** Folded to what has news. `bind:folded` works too. */
		folded?: boolean;
		onfold?: (folded: boolean) => void;
		/** Its level in the page's outline: a SidebarSection's are h2s, a member list's h3s. None: a heading only by look (Other Threads, among a room's rows). */
		level?: 2 | 3;
		/** At its end, after the FoldPill: a SidebarSection's +. */
		end?: Snippet;
		/** A `data-testid` for the heading's button, and one for the FoldPill. */
		toggleTestid?: string;
		expandTestid?: string;
		/** Classes for its row, added to its own. */
		class?: ClassValue;
	}
	let { label, count, folded = $bindable(false), onfold, level, end, toggleTestid, expandTestid, class: className }: Props = $props();
	let heading = $state<HTMLButtonElement | undefined>();

	function fold(next: boolean): void {
		folded = next;
		onfold?.(next);
	}

	/** The pill goes once it has unfolded the list: keyboard focus moves to the heading rather than dropping to the page. */
	function expand(): void {
		heading?.focus();
		fold(false);
	}
</script>

{#snippet toggle()}
	<button type="button" class="ap-sect-toggle" bind:this={heading} aria-expanded={!folded} data-testid={toggleTestid} onclick={() => fold(!folded)}>{label}{#if count !== undefined}<span class="ap-foldhead-count">· {count}</span>{/if}</button>
{/snippet}

<div class={['ap-foldhead', className]}>
	{#if level}<svelte:element this={`h${level}`} class="ap-foldhead-title">{@render toggle()}</svelte:element>{:else}{@render toggle()}{/if}
	{#if folded || end}
		<span class="ap-foldhead-ends">
			{#if folded}<FoldPill label="Show all {label}" testid={expandTestid} onclick={expand} />{/if}
			{@render end?.()}
		</span>
	{/if}
</div>
