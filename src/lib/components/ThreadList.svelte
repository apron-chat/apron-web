<script lang="ts">
	import { untrack } from 'svelte';
	import ThreadItem from '$lib/design/components/ThreadItem.svelte';
	import DesignThreadList from '$lib/design/components/ThreadList.svelte';
	import type { RoomListing } from '$lib/protocol/client';
	import { designTitle, inHeldOrder, threadLatest, threadDescriptionText, type ThreadEntry } from '$lib/ui/timeline';
	import { loadInactiveThreadsOpen, loadOtherThreadsOpen, saveInactiveThreadsOpen, saveOtherThreadsOpen } from '$lib/ui/storage';
	import { minuteNow } from '$lib/ui/clock.svelte';
	import { idAgo, idDateTime, idIso, idMillis } from '$lib/ui/time';

	/** How many of the threads you haven't joined show before "N more…". */
	const OTHERS_SHOWN = 3;
	/** How long a joined thread can go without activity before it may move down to Inactive: long enough to cover a weekend. */
	const INACTIVE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
	const HOUR_MS = 60 * 60 * 1000;
	/** How many of the most recently active joined threads stay up top however quiet: a room of a few keeps them all in view. */
	const ACTIVE_KEPT = 5;

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
		/** Put quiet joined threads away under Inactive: the open room's full list, not one folded to its threads with news. */
		foldInactive?: boolean;
		/**
		 * The room is open without joining it: while you've joined none of its threads either, they list right under
		 * it, all of them, with no Other Threads heading to set them apart from yours.
		 */
		roomUnjoined?: boolean;
		/** Joining and leaving are offered (capability `rooms`, not read-only). */
		canJoin: boolean;
		onthread: (thread: string) => void;
		/** Reads a thread you haven't joined without joining it. */
		onopen: (thread: string) => void;
		onjoin: (thread: string) => void;
		onleave: (thread: string) => void;
	}
	let { roomId, roomTitle, threads, others, activeThread, mentions, unread, muted = {}, foldInactive = false, roomUnjoined = false, canJoin, onthread, onopen, onjoin, onleave }: Props = $props();

	/** A thread you haven't joined: what its listing says, its description as text and when it was last active. */
	type Other = { id: string; title: string; untitled?: true; private: boolean; description: string; latestLogId?: string };

	/** Whether a thread is muted, by its own mute or its room's. */
	const isMuted = (thread: string) => muted[thread] !== undefined || muted[roomId] !== undefined;

	// A room you haven't joined starts with them showing, whatever was saved: joining one of its threads, which sets the rest apart, doesn't fold them away.
	let othersFolded = $state(!untrack(() => roomUnjoined) && !loadOtherThreadsOpen());
	let inactiveFolded = $state(!loadInactiveThreadsOpen());
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
		if (holding.pointer || holding.focus) {
			held ??= joined.map((entry) => entry.id);
			heldQuiet ??= new Map(split.sides);
		} else {
			held = undefined;
			heldQuiet = undefined;
		}
	}
	function focusIn(event: FocusEvent): void {
		// A click focuses the row too, and that focus can stay after the pointer leaves: only the keyboard's holds.
		if (event.target instanceof Element && event.target.matches(':focus-visible')) hold('focus', true);
	}
	function focusOut(event: FocusEvent): void {
		const list = event.currentTarget as HTMLElement;
		if (!(event.relatedTarget instanceof Node && list.contains(event.relatedTarget))) hold('focus', false);
	}
	/**
	 * Joined threads put away under Inactive: past the `ACTIVE_KEPT` most recently active, those quiet for
	 * `INACTIVE_AFTER_MS` with nothing unread or mentioning you, so nothing is missed by putting them away, and a room
	 * of a few threads keeps them all in view. One whose time isn't known stays up top. Each stays on its side while
	 * the list is held, as a click that reads one with news would otherwise drop its row out from under the pointer,
	 * and the open one stays on the side it was on when it was opened, until another is.
	 */
	const activeAt = (entry: ThreadEntry) => (entry.activeId !== undefined ? idMillis(entry.activeId) : undefined);
	/** Counted from now, to the hour: what reads it is redone once an hour, not each minute. */
	let quietSince = $derived(Math.floor((minuteNow() - INACTIVE_AFTER_MS) / HOUR_MS) * HOUR_MS);
	let heldQuiet = $state.raw<Map<string, boolean> | undefined>();
	/** The open thread and its side when it was opened; and each thread's side in the last split, to know that side. */
	let opened: { id: string; quiet: boolean } | undefined;
	let lastSides = new Map<string, boolean>();
	const hasNews = (thread: string) => (unread[thread] ?? 0) > 0 || (mentions[thread] ?? 0) > 0;
	let split = $derived.by(() => {
		const sides = new Map<string, boolean>();
		if (!foldInactive) {
			for (const entry of joined) sides.set(entry.id, false);
		} else {
			const newest = new Set(threads.filter((entry) => entry.joined).toSorted((a, b) => (activeAt(b) ?? Number.MAX_SAFE_INTEGER) - (activeAt(a) ?? Number.MAX_SAFE_INTEGER)).slice(0, ACTIVE_KEPT).map((entry) => entry.id));
			for (const entry of joined) {
				const at = activeAt(entry);
				let quiet = heldQuiet?.get(entry.id) ?? (!newest.has(entry.id) && at !== undefined && at < quietSince && !hasNews(entry.id));
				if (entry.id === activeThread) {
					if (opened?.id !== entry.id) opened = { id: entry.id, quiet: lastSides.get(entry.id) ?? quiet };
					quiet = opened.quiet;
				}
				sides.set(entry.id, quiet);
			}
		}
		if (activeThread === undefined || !sides.has(activeThread)) opened = undefined;
		lastSides = sides;
		return { sides, active: joined.filter((entry) => !sides.get(entry.id)), inactive: joined.filter((entry) => sides.get(entry.id)) };
	});
	let active = $derived(split.active);
	let inactive = $derived(split.inactive);
	/** All of them, or folded, the open one and any that had news while held there. */
	let shownInactive = $derived(inactiveFolded ? inactive.filter((entry) => entry.id === activeThread || hasNews(entry.id)) : inactive);
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
	/** Nothing of the room is yours yet: its threads aren't others to anything, so none are folded or held back. */
	let bare = $derived(roomUnjoined && joined.length === 0);
	/** The first few (or all, after N more…), and always the open one, also while folded. */
	let shownOthers = $derived.by(() => {
		if (bare) return allOthers;
		const open = allOthers.find((other) => other.id === activeThread);
		if (othersFolded) return open ? [open] : [];
		const shown = allFor === roomId ? allOthers : allOthers.slice(0, OTHERS_SHOWN);
		return open && !shown.includes(open) ? [...shown, open] : shown;
	});
	let hiddenOthers = $derived(othersFolded ? 0 : allOthers.length - shownOthers.length);
</script>

<!-- The design system's ThreadList holds the rows, each a ThreadItem; the app says which threads, and what picking one does. -->
{#snippet joinedRows()}
	{#each active as entry (entry.id)}
		{@render joinedRow(entry)}
	{/each}
{/snippet}
{#snippet inactiveRows()}
	{#each shownInactive as entry (entry.id)}
		{@render joinedRow(entry)}
	{/each}
{/snippet}
{#snippet joinedRow(entry: ThreadEntry)}
		{@const open = activeThread === entry.id}
		<!-- Its description, then its latest message: both when it has both, each marked so either reads alone, as on its card. One bubble for what's new: unread replies in grey, orange with an @ when they include a mention. A thread with nothing new shows none, and steps back. -->
		<!-- Leaving is the archive: the thread stops alerting and moves down to Other Threads, on every device. -->
		<ThreadItem
			thread={entry.id} name={designTitle(entry)} private={entry.private} muted={isMuted(entry.id)} active={open}
			unread={open ? 0 : (unread[entry.id] ?? 0)} mentions={open ? 0 : (mentions[entry.id] ?? 0)}
			description={threadDescriptionText(entry)} latest={threadLatest(entry)} linesTestid="thread-list" unreadTestid="thread-unread"
			onselect={() => onthread(entry.id)} onleave={canJoin ? () => onleave(entry.id) : undefined}
		/>
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
		joined={active.length > 0 ? joinedRows : undefined}
		inactive={inactive.length}
		{inactiveRows}
		bind:inactiveFolded
		onfoldinactive={(folded) => saveInactiveThreadsOpen(!folded)}
		inactiveToggleTestid="inactive-threads"
		others={allOthers.length}
		othersBare={bare}
		{otherRows}
		bind:othersFolded
		onfoldothers={(folded) => saveOtherThreadsOpen(!folded)}
		more={hiddenOthers}
		onmore={() => (allFor = roomId)}
		othersToggleTestid="other-threads"
		moreTestid="more-threads"
	/>
</div>
