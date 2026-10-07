<script lang="ts">
	import DoorOpen from '@lucide/svelte/icons/door-open';
	import Lock from '@lucide/svelte/icons/lock';
	import type { RoomListing } from '$lib/protocol/client';
	import { threadPreview, type ThreadEntry } from '$lib/ui/timeline';
	import { loadOtherThreadsOpen, saveOtherThreadsOpen } from '$lib/ui/storage';

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

	type Other = { id: string; title: string; private: boolean };

	let othersOpen = $state(loadOtherThreadsOpen());
	/** The room whose other threads are all showing, past the first few; another room starts short again. */
	let allFor = $state<string | undefined>();
	let joined = $derived(threads.filter((entry) => entry.joined));
	/** The thread open without joining: it stays among the others, picked out, rather than looking joined. */
	let reading = $derived(threads.find((entry) => !entry.joined && entry.id === activeThread));
	let allOthers = $derived.by((): Other[] => {
		const listed = others.map((listing) => ({ id: listing.id, title: listing.title, private: listing.record.private === true }));
		// One opened from elsewhere (a link, or past what the server listed) leads the list while it's open.
		return reading && !listed.some((other) => other.id === reading.id) ? [{ id: reading.id, title: reading.title, private: reading.private === true }, ...listed] : listed;
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
				{@const preview = threadPreview(entry)}
				<div class={['ap-roomrow', 'ap-roomrow-nested', open && 'ap-roomrow-active']}>
					<button class="ap-room ap-room-nested" class:ap-room-active={open} class:ap-room-unread={replies > 0} type="button" data-thread={entry.id} aria-current={open ? 'page' : undefined} onclick={() => onthread(entry.id)}>
						<span class="ap-room-text">
							<span class="ap-room-name">{entry.title}{#if entry.private}<Lock class="ap-lock" role="img" aria-label="Private" />{/if}</span>
							{#if preview}<span class="ap-room-topic" data-testid="thread-list-preview">{preview.label ? `${preview.label}: ` : ''}{preview.text.replace(/\s+/g, ' ')}</span>{/if}
						</span>
						{#if mentions[entry.id] && !open}
							{@const count = mentions[entry.id]}
							<span class="ap-count ap-count-at" data-testid="thread-mentions" aria-label={`${count} ${count === 1 ? 'mention' : 'mentions'}`}>@{count > 1 ? count : ''}</span>
						{:else if replies > 0}
							<span class="ap-count ap-count-quiet" data-testid="thread-unread" aria-label={`${replies} unread ${replies === 1 ? 'reply' : 'replies'}`}>{replies > 99 ? '99+' : replies}</span>
						{/if}
						{#if entry.count !== undefined}
							<small class="room-meta" aria-label={`${entry.count} ${entry.count === 1 ? 'message' : 'messages'}`}>{entry.count}</small>
						{/if}
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
		{#each shownOthers as other (other.id)}
			{@const open = other.id === activeThread}
			<div class={['ap-roomrow', 'ap-roomrow-nested', 'other', open && 'ap-roomrow-active']}>
				<button class="ap-room ap-room-nested" class:ap-room-active={open} type="button" data-other-thread={other.id} data-thread={open ? other.id : undefined} aria-current={open ? 'page' : undefined} title={open ? undefined : `Read ${other.title} without joining`} onclick={() => (open ? onthread(other.id) : onopen(other.id))}>
					<span class="ap-room-text"><span class="ap-room-name">{other.title}{#if other.private}<Lock class="ap-lock" role="img" aria-label="Private" />{/if}</span></span>
					<!-- The one being read has its history loaded, so its count is known. -->
					{#if open && reading?.count !== undefined}
						<small class="room-meta" aria-label={`${reading.count} ${reading.count === 1 ? 'message' : 'messages'}`}>{reading.count}</small>
					{/if}
				</button>
				{#if canJoin}
					<button class="join" type="button" data-join={other.id} aria-label={`Join ${other.title}`} onclick={() => onjoin(other.id)}>Join</button>
				{/if}
			</div>
		{/each}
		{#if hiddenOthers > 0}
			<button class="ap-room ap-room-nested more" type="button" data-testid="more-threads" onclick={() => (allFor = roomId)}>
				<span class="ap-room-text"><span class="ap-room-name">{hiddenOthers} more…</span></span>
			</button>
		{/if}
	{/if}
</div>

<style>
	.threads { display: flex; flex-direction: column; gap: 1px; padding: 2px 0 var(--space-1); }
	.threads .ap-room-nested { padding-top: 5px; padding-bottom: 5px; }
	/* A guide from the room down its joined threads. */
	.joined { position: relative; display: flex; flex-direction: column; gap: 1px; }
	.joined::before { content: ''; position: absolute; left: 21px; top: 0; bottom: 0; width: 1px; background: var(--line); pointer-events: none; }
	/* The title in ink and a little heavier than the preview line under it; heavier still with unread replies. */
	.joined .ap-room-name { color: var(--ink); font-weight: 500; }
	.joined .ap-room-unread .ap-room-name { font-weight: 650; }
	.ap-room-topic { margin-top: 1px; }
	.room-meta { flex: none; font-size: var(--text-sm); line-height: 16px; color: var(--ink-muted); font-variant-numeric: tabular-nums; }
	.ap-room-active .room-meta { color: var(--ink); }

	/* The heading's text lines up with the titles under it; its caret hangs to the left, on the guide's line. */
	.others-head { display: flex; margin: var(--space-2) 0 1px; padding-left: calc(var(--space-3) + var(--space-4)); }
	.others-head .ap-sect-toggle { position: relative; padding-left: 0; }
	.others-head .ap-sect-caret { position: absolute; left: -12px; width: 10px; text-align: center; }
	.others-count { margin-left: 2px; font-weight: 400; }
	.shut .ap-sect-caret { transform: rotate(-90deg); }
	.other .ap-room-name { color: var(--ink-muted); }
	.other:hover .ap-room-name, .other:focus-within .ap-room-name, .other .ap-room-active .ap-room-name { color: var(--ink); }
	.more .ap-room-name { color: var(--denim); font-size: var(--text-sm); }

	/* Join shows on the row under the pointer or focus, where Leave shows on a joined one; always on touch, which can't hover. */
	.join { position: absolute; top: 50%; right: var(--space-2); transform: translateY(-50%); font: inherit; font-size: var(--text-sm); line-height: 16px; padding: 2px var(--space-2); border: 1px solid var(--line-strong); border-radius: 999px; background: var(--bg-100); color: var(--ink); cursor: pointer; opacity: 0; transition: opacity .12s ease; }
	.join:hover { border-color: var(--ink); }
	.join:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
	.other:hover .join, .other:focus-within .join, .ap-roomrow-active .join { opacity: 1; }
	.other:hover .ap-room, .other:focus-within .ap-room, .ap-roomrow-active .ap-room { padding-right: 56px; }
	@media (hover: none) { .join { opacity: 1; } .other .ap-room { padding-right: 56px; } }
	@media (prefers-reduced-motion: reduce) { .join { transition: none; } }
</style>
