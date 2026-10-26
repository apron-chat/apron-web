<script lang="ts">
	import ThreadItem from '$lib/design/components/ThreadItem.svelte';
	import DesignThreadList from '$lib/design/components/ThreadList.svelte';
	import type { RoomListing } from '$lib/protocol/client';
	import { designTitle, inHeldOrder, threadLatest, threadDescriptionText, type ThreadEntry } from '$lib/ui/timeline';
	import { loadOtherThreadsOpen, saveOtherThreadsOpen } from '$lib/ui/storage';
	import { minuteNow } from '$lib/ui/clock.svelte';
	import { idAgo, idDateTime, idIso } from '$lib/ui/time';

	/** How many of the threads you haven't joined show before "N more…". */
	const OTHERS_SHOWN = 3;

	interface Props {
		/** The room the threads belong to: its `room_id` and title. */
		roomId: string;
		roomTitle: string;
		/** Its threads you've joined, most recently active first, and one open without joining while it's open, which lists with the others. */
		threads: ThreadEntry[];
		/** Its other threads, from `room_list` `not_joined` (§4.2.1): most recently active first, and maybe not all. */
		others: RoomListing[];
		activeThread?: string;
		mentions: Record<string, number>;
		unread: Record<string, number>;
		/** The rooms and threads you muted (§4.5 `mute` with its `room_id`), by `room_id`: a thread is muted by its own, or its room's. */
		muted?: Record<string, number | true>;
		/** Joining and leaving are offered (capability `rooms`, not read-only). */
		canJoin: boolean;
		onthread: (thread: string) => void;
		/** Reads a thread you haven't joined without joining it. */
		onopen: (thread: string) => void;
		onjoin: (thread: string) => void;
		onleave: (thread: string) => void;
	}
	let { roomId, roomTitle, threads, others, activeThread, mentions, unread, muted = {}, canJoin, onthread, onopen, onjoin, onleave }: Props = $props();

	/** A thread you haven't joined: what its listing says, its description as text and when it was last active. */
	type Other = { id: string; title: string; untitled?: true; private: boolean; description: string; latestLogId?: string };

	/** Whether a thread is muted, by its own mute or its room's. */
	const isMuted = (thread: string) => muted[thread] !== undefined || muted[roomId] !== undefined;

	let othersOpen = $state(loadOtherThreadsOpen());
	/** The room whose other threads are all showing, past the first few; another room starts short again. */
	let allFor = $state<string | undefined>();
	/**
	 * The joined threads' order while the pointer is on the list, or keyboard
	 * focus is in it: a reply elsewhere moves its thread up once the pointer
	 * leaves, so a row never slides out from under a click.
	 */
	let held = $state<string[] | undefined>();
	const holding = { pointer: false, focus: false };
	let joined = $derived.by(() => {
		const live = threads.filter((entry) => entry.joined);
		return held ? inHeldOrder(live, held) : live;
	});
	function hold(by: keyof typeof holding, on: boolean): void {
		holding[by] = on;
		if (holding.pointer || holding.focus) held ??= joined.map((entry) => entry.id);
		else held = undefined;
	}
	function focusIn(event: FocusEvent): void {
		// A click focuses the row too, and that focus can stay after the pointer leaves: only the keyboard's holds.
		if (event.target instanceof Element && event.target.matches(':focus-visible')) hold('focus', true);
	}
	function focusOut(event: FocusEvent): void {
		const list = event.currentTarget as HTMLElement;
		if (!(event.relatedTarget instanceof Node && list.contains(event.relatedTarget))) hold('focus', false);
	}
	/** The thread open without joining: it stays among the others, picked out, rather than looking joined. */
	let reading = $derived(threads.find((entry) => !entry.joined && entry.id === activeThread));
	let allOthers = $derived.by((): Other[] => {
		const listed = others.map((listing): Other => ({
			id: listing.id, title: listing.title, ...(listing.untitled ? { untitled: true as const } : {}), private: listing.record.private === true,
			description: threadDescriptionText({ description: typeof listing.record.description === 'string' ? listing.record.description : undefined }),
			...(listing.latestLogId !== undefined ? { latestLogId: listing.latestLogId } : {})
		}));
		// One opened from elsewhere (a link, or past what the server listed) leads the list while it's open.
		return reading && !listed.some((other) => other.id === reading.id)
			? [{ id: reading.id, title: reading.title, ...(reading.untitled ? { untitled: true as const } : {}), private: reading.private === true, description: threadDescriptionText(reading), ...(reading.latestMessage ? { latestLogId: reading.latestMessage.message_id } : {}) }, ...listed]
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

<!-- The design system's ThreadList holds the rows, each a ThreadItem; the app says which threads, and what picking one does. -->
{#snippet joinedRows()}
	{#each joined as entry (entry.id)}
		{@const open = activeThread === entry.id}
		<!-- Its description, then its latest message: both when it has both, each marked so either reads alone, as on its card. One bubble for what's new: unread replies in grey, orange with an @ when they include a mention. A thread with nothing new shows none, and steps back. -->
		<!-- Leaving is the archive: the thread stops alerting and moves down to Other threads, on every device. -->
		<ThreadItem
			thread={entry.id} name={designTitle(entry)} private={entry.private} muted={isMuted(entry.id)} active={open}
			unread={open ? 0 : (unread[entry.id] ?? 0)} mentions={open ? 0 : (mentions[entry.id] ?? 0)}
			description={threadDescriptionText(entry)} latest={threadLatest(entry)} linesTestid="thread-list" unreadTestid="thread-unread"
			onselect={() => onthread(entry.id)} onleave={canJoin ? () => onleave(entry.id) : undefined}
		/>
	{/each}
{/snippet}
{#snippet otherRows()}
	{#each shownOthers as other (other.id)}
		{@const open = other.id === activeThread}
		{@const last = other.latestLogId}
		<!-- The one being read has its history loaded, so its count is known; the others say when they were last active. Joining is a door in, as leaving is a door out. -->
		<ThreadItem
			thread={other.id} name={designTitle(other)} private={other.private} muted={isMuted(other.id)} unjoined active={open} description={other.description} linesTestid="other-thread"
			count={open ? reading?.count : undefined}
			ago={last !== undefined ? { text: idAgo(last, minuteNow()), datetime: idIso(last), title: `Last active ${idDateTime(last)}` } : undefined} agoTestid="other-thread-ago"
			title={open ? undefined : `Read ${other.title} without joining`}
			onselect={() => (open ? onthread(other.id) : onopen(other.id))} onjoin={canJoin ? () => onjoin(other.id) : undefined}
		/>
	{/each}
{/snippet}

<!-- Holds the joined threads' order while the pointer or keyboard is on the list (`held`); the rows inside are the controls. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div onpointerenter={() => hold('pointer', true)} onpointerleave={() => hold('pointer', false)} onfocusin={focusIn} onfocusout={focusOut}>
	<DesignThreadList
		testid="thread-list"
		room={roomTitle}
		joined={joined.length > 0 ? joinedRows : undefined}
		others={allOthers.length}
		{otherRows}
		bind:othersOpen
		ontoggleothers={saveOtherThreadsOpen}
		more={hiddenOthers}
		onmore={() => (allFor = roomId)}
		othersToggleTestid="other-threads"
		moreTestid="more-threads"
	/>
</div>
