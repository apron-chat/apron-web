<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import FoldHeading from './FoldHeading.svelte';

	interface Props {
		/** The room's title, for the group's label: "Threads in <room>". */
		room: string;
		/** The rows of its threads you've joined (<ThreadItem>s), along a solid guide down from the room. */
		joined?: Snippet;
		/** How many joined threads have been quiet a while: "Inactive · N", a FoldHeading between them and Other Threads. None hides it. */
		inactive?: number;
		/** Their rows (<ThreadItem>s), along the joined threads' guide, as they're still yours. */
		inactiveRows?: Snippet;
		/** Folded: show only the open one, if it's among them, and the heading's …. Bindable. */
		inactiveFolded?: boolean;
		onfoldinactive?: (folded: boolean) => void;
		/** A `data-testid` for the Inactive heading, and one for its …. */
		inactiveToggleTestid?: string;
		inactiveExpandTestid?: string;
		/** How many threads of the room you haven't joined there are (§4.2.1 `not_joined`): "Other Threads · N", a FoldHeading. None hides it. */
		others?: number;
		/** Their rows (<ThreadItem>s, `unjoined`), along a dashed guide, as they aren't yours yet. */
		otherRows?: Snippet;
		/** Folded: show only the open one, if it's among them (they have no news, §3.4), and the heading's …. Bindable. */
		othersFolded?: boolean;
		onfoldothers?: (folded: boolean) => void;
		/** How many other threads aren't shown: a "N more…" row after them. */
		more?: number;
		onmore?: () => void;
		/** A `data-testid` for the Other Threads heading, one for its …, and one for the "N more…" row. */
		othersToggleTestid?: string;
		othersExpandTestid?: string;
		moreTestid?: string;
		/** Classes for the group, added to its own. */
		class?: ClassValue;
		/** A `data-testid` for the group. */
		testid?: string;
	}
	let { room, joined, inactive = 0, inactiveRows, inactiveFolded = $bindable(false), onfoldinactive, inactiveToggleTestid, inactiveExpandTestid, others = 0, otherRows, othersFolded = $bindable(false), onfoldothers, more = 0, onmore, othersToggleTestid, othersExpandTestid, moreTestid, class: className, testid }: Props = $props();
</script>

<div role="group" aria-label="Threads in {room}" data-testid={testid} class={['ap-threads', className]}>
	{#if joined}<div class="ap-threads-joined">{@render joined()}</div>{/if}
	{#if inactive > 0}
		<!-- Joined threads with nothing new for a while: still yours, so along the same guide, but put away under a heading that folds. -->
		<FoldHeading class="ap-threads-head" label="Inactive" count={inactive} bind:folded={inactiveFolded} onfold={onfoldinactive} toggleTestid={inactiveToggleTestid} expandTestid={inactiveExpandTestid} />
		<div class="ap-threads-joined ap-threads-inactive">{@render inactiveRows?.()}</div>
	{/if}
	{#if others > 0}
		<!-- These deliver nothing live (§3.4), so they have no counts or previews, and fold to none but the open one. -->
		<FoldHeading class="ap-threads-head" label="Other Threads" count={others} bind:folded={othersFolded} onfold={onfoldothers} toggleTestid={othersToggleTestid} expandTestid={othersExpandTestid} />
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
