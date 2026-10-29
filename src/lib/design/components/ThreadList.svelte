<script lang="ts">
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';

	interface Props {
		/** The room's title, for the group's label: "Threads in <room>". */
		room: string;
		/** The rows of its threads you've joined (<ThreadItem>s), along a solid guide down from the room. */
		joined?: Snippet;
		/** Folded to the threads with news: a "…" row after them, along the same guide, that shows them all again. */
		onexpand?: () => void;
		/** How many threads of the room you haven't joined there are (§4.2.1 `not_joined`): "Other threads · N", a heading that folds. None hides it. */
		others?: number;
		/** Their rows (<ThreadItem>s, `unjoined`), along a dashed guide, as they aren't yours yet. */
		otherRows?: Snippet;
		/** Whether the other threads show; bindable. Folded, show only the open one, if it's among them. */
		othersOpen?: boolean;
		ontoggleothers?: (open: boolean) => void;
		/** How many other threads aren't shown: a "N more…" row after them. */
		more?: number;
		onmore?: () => void;
		/** A `data-testid` for the Other threads heading's toggle, one for the "N more…" row, and one for the folded list's "…". */
		othersToggleTestid?: string;
		moreTestid?: string;
		expandTestid?: string;
		/** Classes for the group, added to its own. */
		class?: ClassValue;
		/** A `data-testid` for the group. */
		testid?: string;
	}
	let { room, joined, onexpand, others = 0, otherRows, othersOpen = $bindable(true), ontoggleothers, more = 0, onmore, othersToggleTestid, moreTestid, expandTestid, class: className, testid }: Props = $props();

	function toggle(): void {
		othersOpen = !othersOpen;
		ontoggleothers?.(othersOpen);
	}
</script>

<div role="group" aria-label="Threads in {room}" data-testid={testid} class={['ap-threads', className]}>
	{#if joined || onexpand}
		<div class="ap-threads-joined">
			{@render joined?.()}
			{#if onexpand}
				<!-- A small pill rather than a row, so the folded list reads as cut short. -->
				<button class="ap-threads-expand" type="button" aria-label="Show all threads in {room}" title="Show all threads" data-testid={expandTestid} onclick={onexpand}><Ellipsis size={14} aria-hidden="true" /></button>
			{/if}
		</div>
	{/if}
	{#if others > 0}
		<!-- A heading that folds, like a SidebarSection: these deliver nothing live (§3.4), so they have no counts or previews. -->
		<div class="ap-threads-head">
			<button class={['ap-sect-toggle', !othersOpen && 'ap-sect-closed']} type="button" aria-expanded={othersOpen} data-testid={othersToggleTestid} onclick={toggle}>
				<span class="ap-sect-caret" aria-hidden="true">▾</span>Other threads<span class="ap-threads-count">· {others}</span>
			</button>
		</div>
		<div class="ap-threads-others">
			{@render otherRows?.()}
			{#if more > 0}
				<button class="ap-room ap-room-nested ap-threads-more" type="button" data-testid={moreTestid} onclick={onmore}>
					<span class="ap-room-text"><span class="ap-room-name">{more} more…</span></span>
				</button>
			{/if}
		</div>
	{/if}
</div>
