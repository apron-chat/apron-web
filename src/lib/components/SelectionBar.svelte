<script lang="ts">
	import DesignSelectionBar from '$lib/design/components/SelectionBar.svelte';
	import type { MessageSelection } from '$lib/ui/selection.svelte';
	import { designTitle, type ThreadEntry } from '$lib/ui/timeline';

	interface Props {
		selection: MessageSelection;
		/** Threads the picked messages can move to, besides a new one; the open thread is left out. */
		threads: ThreadEntry[];
		/** In a thread, messages can also go back to the room: its ID. */
		parentRoom?: string;
		/** Creating threads needs capability `rooms`. */
		canCreateThread: boolean;
		onmove: (room: string) => void;
		onnewthread: () => void;
		onfill: () => void;
		oncancel: () => void;
	}
	let { selection, threads, parentRoom, canCreateThread, onmove, onnewthread, onfill, oncancel }: Props = $props();
	let current = $derived(selection.current);
	let count = $derived(current?.ids.length ?? 0);
	let destinations = $derived(threads.map((thread) => ({ thread: thread.id, name: designTitle(thread) })));
</script>

{#if current}
	<!-- The menu's open state lives on the selection, so the page can close it (Escape, or a move starting). -->
	<DesignSelectionBar
		{count} threads={destinations} room={parentRoom} status={current.saving ? 'saving' : 'idle'} denied={current.denied}
		bind:open={selection.menuOpen} data-testid="selection-bar" newThreadTestid="new-thread"
		{onmove} onnewthread={canCreateThread ? onnewthread : undefined} onselectrange={count > 1 && !current.saving ? onfill : undefined} {oncancel}
	/>
{/if}
