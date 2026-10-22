<script lang="ts">
	import RoomItem from '$lib/design/components/RoomItem.svelte';
	import DesignThreadList from '$lib/design/components/ThreadList.svelte';
	import type { RoomListing } from '$lib/protocol/client';
	import { threadLatest, threadSummaryText, type ThreadEntry } from '$lib/ui/timeline';
	import { loadOtherThreadsOpen, saveOtherThreadsOpen } from '$lib/ui/storage';
	import { minuteNow } from '$lib/ui/clock.svelte';
	import { idAgo, idDateTime, idIso } from '$lib/ui/time';

	/** How many of the threads you haven't joined show before "N more…". */
	const OTHERS_SHOWN = 3;

	interface Props {
		/** The room the threads belong to: its `room_id` and title. */
		roomId: string;
		roomTitle: string;
		/** Its threads you've joined, and one open without joining while it's open, which lists with the others. */
		threads: ThreadEntry[];
		/** Its other threads, from `room_list` `not_joined` (§4.2.1): most recently active first, and maybe not all. */
		others: RoomListing[];
		activeThread?: string;
		mentions: Record<string, number>;
		unread: Record<string, number>;
		/** Joining and leaving are offered (capability `rooms`, not read-only). */
		canJoin: boolean;
		onthread: (thread: string) => void;
		/** Reads a thread you haven't joined without joining it. */
		onopen: (thread: string) => void;
		onjoin: (thread: string) => void;
		onleave: (thread: string) => void;
	}
	let { roomId, roomTitle, threads, others, activeThread, mentions, unread, canJoin, onthread, onopen, onjoin, onleave }: Props = $props();

	/** A thread you haven't joined: what its listing says, its summary as text and when it was last active. */
	type Other = { id: string; title: string; private: boolean; summary: string; latestLogId?: string };

	let othersOpen = $state(loadOtherThreadsOpen());
	/** The room whose other threads are all showing, past the first few; another room starts short again. */
	let allFor = $state<string | undefined>();
	let joined = $derived(threads.filter((entry) => entry.joined));
	/** The thread open without joining: it stays among the others, picked out, rather than looking joined. */
	let reading = $derived(threads.find((entry) => !entry.joined && entry.id === activeThread));
	let allOthers = $derived.by((): Other[] => {
		const listed = others.map((listing): Other => ({
			id: listing.id, title: listing.title, private: listing.record.private === true,
			summary: threadSummaryText({ description: typeof listing.record.description === 'string' ? listing.record.description : undefined }),
			...(listing.latestLogId !== undefined ? { latestLogId: listing.latestLogId } : {})
		}));
		// One opened from elsewhere (a link, or past what the server listed) leads the list while it's open.
		return reading && !listed.some((other) => other.id === reading.id)
			? [{ id: reading.id, title: reading.title, private: reading.private === true, summary: threadSummaryText(reading), ...(reading.latestMessage ? { latestLogId: reading.latestMessage.message_id } : {}) }, ...listed]
			: listed;
	});
	/** The first few (or all, after N more…), and always the open one, also while folded. */
	let shownOthers = $derived.by(() => {
		const open = allOthers.find((other) => other.id === activeThread);
		if (!othersOpen) return open ? [open] : [];
		const shown = allFor === roomId ? allOthers : allOthers.slice(0, OTHERS_SHOWN);
		return open && !shown.includes(open) ? [...shown, open] : shown;
	});
	let hiddenOthers = $derived(othersOpen ? allOthers.length - shownOthers.length : 0);
</script>

<!-- The design system's ThreadList holds the rows, each a nested RoomItem; the app says which threads, and what picking one does. -->
{#snippet joinedRows()}
	{#each joined as entry (entry.id)}
		{@const open = activeThread === entry.id}
		<!-- Its summary, then its latest message: both when it has both, each marked so either reads alone, as on its card. One bubble for what's new: unread replies in grey, orange with an @ when they include a mention. A thread with nothing new shows none, and steps back. -->
		<!-- Leaving is the archive: the thread stops alerting and moves down to Other threads, on every device. -->
		<RoomItem
			room={entry.id} name={entry.title} private={entry.private} nested active={open}
			unread={open ? 0 : (unread[entry.id] ?? 0)} mentions={open ? 0 : (mentions[entry.id] ?? 0)}
			summary={threadSummaryText(entry)} latest={threadLatest(entry)} testid="thread-list" countTestid="thread-unread"
			data-thread={entry.id} onselect={() => onthread(entry.id)} onleave={canJoin ? () => onleave(entry.id) : undefined}
		/>
	{/each}
{/snippet}
{#snippet otherRows()}
	{#each shownOthers as other (other.id)}
		{@const open = other.id === activeThread}
		{@const last = other.latestLogId}
		<!-- The one being read has its history loaded, so its count is known; the others say when they were last active. Joining is a door in, as leaving is a door out. -->
		<RoomItem
			room={other.id} name={other.title} private={other.private} nested unjoined active={open} summary={other.summary} testid="other-thread"
			count={open ? reading?.count : undefined}
			ago={last !== undefined ? idAgo(last, minuteNow()) : undefined}
			agoIso={last !== undefined ? idIso(last) : undefined} agoTitle={last !== undefined ? `Last active ${idDateTime(last)}` : undefined}
			data-other-thread={other.id} data-thread={open ? other.id : undefined} title={open ? undefined : `Read ${other.title} without joining`}
			onselect={() => (open ? onthread(other.id) : onopen(other.id))} onjoin={canJoin ? () => onjoin(other.id) : undefined}
		/>
	{/each}
{/snippet}

<DesignThreadList
	room={roomTitle}
	joined={joined.length > 0 ? joinedRows : undefined}
	others={allOthers.length}
	{otherRows}
	bind:othersOpen
	ontoggleothers={saveOtherThreadsOpen}
	more={hiddenOthers}
	onmore={() => (allFor = roomId)}
/>
