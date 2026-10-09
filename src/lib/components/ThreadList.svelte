<script lang="ts">
	import CornerDownRight from '@lucide/svelte/icons/corner-down-right';
	import DoorOpen from '@lucide/svelte/icons/door-open';
	import Lock from '@lucide/svelte/icons/lock';
	import LogIn from '@lucide/svelte/icons/log-in';
	import TextAlignStart from '@lucide/svelte/icons/text-align-start';
	import UnreadCount from '$lib/design/components/UnreadCount.svelte';
	import type { RoomListing } from '$lib/protocol/client';
	import { threadLatest, threadSummaryText, type ThreadEntry } from '$lib/ui/timeline';
	import { loadOtherThreadsOpen, saveOtherThreadsOpen } from '$lib/ui/storage';
	import { idAgo, idDateTime, idIso } from '$lib/ui/time';

	/** How many of the threads you haven't joined show before "N more…". */
	const OTHERS_SHOWN = 3;

	interface Props {
		/** The room the threads belong to: its `room_id` and title. */
		roomId: string;
		roomTitle: string;
		/** Its threads you've joined, and one open without joining while it's open, which lists with the others. */
		threads: ThreadEntry[];
		/** Its other threads, from `room_list` `not_joined` (§4.3.1): most recently active first, and maybe not all. */
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

	/** The clock the others' last-active times are read against, a minute at a time, so `5m` doesn't stay `5m`. */
	let now = $state(Date.now());
	$effect(() => {
		const timer = setInterval(() => (now = Date.now()), 60_000);
		return () => clearInterval(timer);
	});

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

	function toggleOthers(): void {
		othersOpen = !othersOpen;
		saveOtherThreadsOpen(othersOpen);
	}
</script>

<div class="threads" data-testid="thread-list" role="group" aria-label={`Threads in ${roomTitle}`}>
	{#if joined.length > 0}
		<div class="joined">
			{#each joined as entry (entry.id)}
				{@const open = activeThread === entry.id}
				{@const replies = open ? 0 : (unread[entry.id] ?? 0)}
				{@const mentioned = open ? 0 : (mentions[entry.id] ?? 0)}
				{@const summary = threadSummaryText(entry).replace(/\s+/g, ' ')}
				{@const latest = threadLatest(entry)}
				<div class={['ap-roomrow', 'ap-roomrow-nested', open && 'ap-roomrow-active']}>
					<button class="ap-room ap-room-nested" class:ap-room-active={open} class:ap-room-unread={replies > 0 || mentioned > 0} class:ap-room-mention={mentioned > 0} class:ap-room-quiet={!open && !replies && !mentioned} type="button" data-thread={entry.id} aria-current={open ? 'page' : undefined} onclick={() => onthread(entry.id)}>
						<span class="ap-room-text">
							<span class="ap-room-name">{entry.title}{#if entry.private}<Lock class="ap-lock" role="img" aria-label="Private" />{/if}</span>
							<!-- Its summary, then its latest message: both when it has both, each marked so either reads alone. -->
							{#if summary}<span class="ap-room-line ap-room-line-summary" data-testid="thread-list-summary"><TextAlignStart role="img" aria-label="Summary" /><span class="ap-room-line-text">{summary}</span></span>{/if}
							{#if latest}
								<span class="ap-room-line ap-room-line-latest" data-testid="thread-list-latest"><CornerDownRight role="img" aria-label="Latest message" /><span class="ap-room-line-text">{#if latest.sender}<span class="ap-room-sender">{latest.sender}</span>{' '}{/if}{latest.text}</span></span>
							{/if}
						</span>
						<!-- One bubble for what's new: unread replies in grey, orange with an @ when they include a mention. A thread with nothing new shows none, and steps back. -->
						<UnreadCount unread={replies} mentions={mentioned} noun="reply" testid="thread-unread" />
					</button>
					<!-- Leaving is the archive: the thread stops alerting and moves down to Other threads, on every device. -->
					{#if canJoin}
						<button class="ap-room-exit" type="button" data-leave={entry.id} title="Leave thread" aria-label={`Leave ${entry.title}`} onclick={() => onleave(entry.id)}><DoorOpen size={15} aria-hidden="true" /></button>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
	{#if allOthers.length > 0}
		<!-- A heading that folds, like Browse rooms: these deliver nothing live (§3.4), so they have no counts or previews. -->
		<div class="others-head">
			<button class="ap-sect-toggle" class:shut={!othersOpen} type="button" aria-expanded={othersOpen} data-testid="other-threads" onclick={toggleOthers}>
				<span class="ap-sect-caret" aria-hidden="true">▾</span>Other threads<span class="others-count">· {allOthers.length}</span>
			</button>
		</div>
		<!-- The guide carries on, dashed, beside the threads you haven't joined. -->
		<div class="others">
			{#each shownOthers as other (other.id)}
				{@const open = other.id === activeThread}
				{@const summary = other.summary.replace(/\s+/g, ' ')}
				{@const ago = other.latestLogId !== undefined ? idAgo(other.latestLogId, now) : ''}
				<div class={['ap-roomrow', 'ap-roomrow-nested', open && 'ap-roomrow-active']}>
					<button class="ap-room ap-room-nested ap-room-unjoined" class:ap-room-active={open} type="button" data-other-thread={other.id} data-thread={open ? other.id : undefined} aria-current={open ? 'page' : undefined} title={open ? undefined : `Read ${other.title} without joining`} onclick={() => (open ? onthread(other.id) : onopen(other.id))}>
						<span class="ap-room-text">
							<span class="ap-room-name">{other.title}{#if other.private}<Lock class="ap-lock" role="img" aria-label="Private" />{/if}</span>
							{#if summary}<span class="ap-room-line ap-room-line-summary" data-testid="other-thread-summary"><TextAlignStart role="img" aria-label="Summary" /><span class="ap-room-line-text">{summary}</span></span>{/if}
						</span>
						<!-- The one being read has its history loaded, so its count is known; the others say when they were last active. -->
						{#if open && reading?.count !== undefined}
							<small class="room-meta" aria-label={`${reading.count} ${reading.count === 1 ? 'message' : 'messages'}`}>{reading.count}</small>
						{:else if ago}
							<time class="ap-room-ago" data-testid="other-thread-ago" datetime={idIso(other.latestLogId ?? '')} title={`Last active ${idDateTime(other.latestLogId ?? '')}`}>{ago}</time>
						{/if}
					</button>
					<!-- Joining is a door in, as leaving is a door out. -->
					{#if canJoin}
						<button class="ap-room-join" type="button" data-join={other.id} title="Join thread" aria-label={`Join ${other.title}`} onclick={() => onjoin(other.id)}><LogIn size={15} aria-hidden="true" /></button>
					{/if}
				</div>
			{/each}
			{#if hiddenOthers > 0}
				<button class="ap-room ap-room-nested more" type="button" data-testid="more-threads" onclick={() => (allFor = roomId)}>
					<span class="ap-room-text"><span class="ap-room-name">{hiddenOthers} more…</span></span>
				</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.threads { display: flex; flex-direction: column; gap: 1px; padding: 2px 0 var(--space-1); }
	.threads .ap-room-nested { padding-top: 5px; padding-bottom: 5px; }
	/* A guide from the room down its joined threads. */
	.joined { position: relative; display: flex; flex-direction: column; gap: 1px; }
	.joined::before { content: ''; position: absolute; left: 21px; top: 0; bottom: 0; width: 1px; background: var(--line); pointer-events: none; }
	/* The title in ink and a little heavier than the preview line under it; heavier still with unread replies. A thread with nothing new steps back (apron.css). */
	.joined .ap-room:not(.ap-room-quiet) .ap-room-name { color: var(--ink); font-weight: 500; }
	.joined .ap-room.ap-room-active .ap-room-name { font-weight: 600; }
	.joined .ap-room.ap-room-unread .ap-room-name { font-weight: 650; }
	.room-meta { flex: none; font-size: var(--text-sm); line-height: 18px; color: var(--ink-muted); font-variant-numeric: tabular-nums; }
	.ap-room-active .room-meta { color: var(--ink); }

	/* The heading's text lines up with the titles under it; its caret hangs to the left, on the guide's line. */
	.others-head { display: flex; margin: var(--space-2) 0 1px; padding-left: calc(var(--space-3) + var(--space-4)); }
	.others-head .ap-sect-toggle { position: relative; padding-left: 0; }
	.others-head .ap-sect-caret { position: absolute; left: -12px; width: 10px; text-align: center; }
	.others-count { margin-left: 2px; font-weight: 400; }
	.shut .ap-sect-caret { transform: rotate(-90deg); }
	.more .ap-room-name { color: var(--denim); font-size: var(--text-sm); }
	/* The guide from the room carries on beside the threads you haven't joined, dashed, as they aren't yours yet. */
	.others { position: relative; display: flex; flex-direction: column; gap: 1px; }
	.others::before { content: ''; position: absolute; left: 21px; top: 0; bottom: 0; border-left: 1px dashed var(--line-strong); pointer-events: none; }
	/* The one being read keeps its Join in view, beside its count. */
	.others .ap-roomrow-active .ap-room-join { opacity: 1; pointer-events: auto; }
	.others .ap-roomrow-active .ap-room { padding-right: 32px; }
</style>
