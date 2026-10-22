<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** The room's title, for the group's label: "Threads in <room>". */
		room: string;
		/** The rows of its threads you've joined (nested <RoomItem>s), along a solid guide down from the room. */
		joined?: Snippet;
		/** How many threads of the room you haven't joined there are (§4.2.1 `not_joined`): "Other threads · N", a heading that folds. None hides it. */
		others?: number;
		/** Their rows (nested <RoomItem>s, `unjoined`), along a dashed guide, as they aren't yours yet. */
		otherRows?: Snippet;
		/** Whether the other threads show; bindable. Folded, show only the open one, if it's among them. */
		othersOpen?: boolean;
		ontoggleothers?: (open: boolean) => void;
		/** How many other threads aren't shown: a "N more…" row after them. */
		more?: number;
		onmore?: () => void;
	}
	let { room, joined, others = 0, otherRows, othersOpen = $bindable(true), ontoggleothers, more = 0, onmore }: Props = $props();

	function toggle(): void {
		othersOpen = !othersOpen;
		ontoggleothers?.(othersOpen);
	}
</script>

<div class="ap-threads" data-testid="thread-list" role="group" aria-label="Threads in {room}">
	{#if joined}<div class="ap-threads-joined">{@render joined()}</div>{/if}
	{#if others > 0}
		<!-- A heading that folds, like a SidebarSection: these deliver nothing live (§3.4), so they have no counts or previews. -->
		<div class="ap-threads-head">
			<button class={['ap-sect-toggle', !othersOpen && 'ap-sect-closed']} type="button" aria-expanded={othersOpen} data-testid="other-threads" onclick={toggle}>
				<span class="ap-sect-caret" aria-hidden="true">▾</span>Other threads<span class="ap-threads-count">· {others}</span>
			</button>
		</div>
		<div class="ap-threads-others">
			{@render otherRows?.()}
			{#if more > 0}
				<button class="ap-room ap-room-nested ap-threads-more" type="button" data-testid="more-threads" onclick={onmore}>
					<span class="ap-room-text"><span class="ap-room-name">{more} more…</span></span>
				</button>
			{/if}
		</div>
	{/if}
</div>
