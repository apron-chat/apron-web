<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import Lock from '@lucide/svelte/icons/lock';
	import Avatar from './Avatar.svelte';
	import ThreadLines from './ThreadLines.svelte';
	import UnreadCount from './UnreadCount.svelte';
	import type { Sender } from './types';
	import { roomName, roomNameTip, times, uid } from './util';

	/** A thread's card, which names it in `data-thread`. Its `class` and `testid` go on the card, not the `row` around it. */
	interface Props {
		/** The thread's `room_id` (a room with `parent_room_id`, §3.4). */
		thread: string;
		/** Its `title`; without one it's called "Untitled", with its `room_id` on hover. */
		name?: string;
		/** Unread replies from others, and how many mention you: a bubble beside the time, as on its sidebar row. Leave out when unknown. */
		unread?: number;
		mentions?: number;
		/** Visible only to its members (§4.2.4): a plum card, its title led by a lock. */
		private?: boolean;
		/** The thread's `description` (§3.4) as text: its summary, or the gist of the message that started it. */
		summary?: string;
		/** The thread's members or recent senders, most recent first; up to 4 are shown. */
		participants?: Sender[];
		/** Replaces the participants' faces, such as with your own avatars; leave out when there are none. */
		faces?: Snippet;
		/** Pre-formatted time of the newest message, compact within two weeks: "9h", "12d", then "14 Sep"; shown at the right, unlabelled. */
		lastReply?: string;
		/** Epoch ms of the newest message: makes `lastReply` a `<time>`, its exact time on hover. */
		lastReplyAt?: number;
		/** The newest message, on the line after the summary (up to three lines). Shorten `text` yourself. `sender` may be the name as you show it. */
		latest?: { sender: Sender | string; text: string };
		/** Render the "Moved to …" marker where a moved message used to be. */
		moved?: boolean;
		/** On a row of its own in the timeline, rather than under a message: lined up with the message text. */
		row?: boolean;
		/** A `data-testid` for the unread bubble. */
		unreadTestid?: string;
		/** A `data-testid` for the last reply's time. */
		lastReplyTestid?: string;
		/** A `data-testid` for the summary's line. */
		summaryTestid?: string;
		/** A `data-testid` for the newest message's line. */
		latestTestid?: string;
		onopen?: () => void;
		/** One of the timeline's rows, as a message is: `data-timeline-item`, which a timeline finds its rows by. */
		timelineItem?: boolean;
		/** Classes for the card, added to its own. */
		class?: ClassValue;
		/** A `data-testid` for the card. */
		testid?: string;
	}
	let {
		thread, name, unread = 0, mentions = 0, private: isPrivate, summary, participants, faces: facesSnippet, lastReply, lastReplyAt, latest, moved, row,
		unreadTestid, lastReplyTestid, summaryTestid, latestTestid, onopen, timelineItem = false, class: className, testid
	}: Props = $props();
	const item = $derived(timelineItem ? '' : undefined);
	const shown = $derived(roomName(name, thread, { thread: true }));
	const tip = $derived(roomNameTip(name, thread, { thread: true }));
	const faces = $derived((participants || []).slice(0, 4));
	const last = $derived(latest ? { sender: typeof latest.sender === 'string' ? latest.sender : latest.sender?.name || uid(latest.sender) || '', text: latest.text } : undefined);
	const at = $derived(times(lastReplyAt));
</script>

{#snippet marker()}
	{#if moved}
		<div data-timeline-item={item} data-testid={testid} class={['ap-thread', 'ap-thread-moved', className]}><span>{'Moved to '}</span><button type="button" class="ap-link" title={tip} onclick={onopen}>{shown}</button></div>
	{:else}
		<button type="button" data-thread={thread} data-timeline-item={item} data-testid={testid} class={['ap-thread', (summary || last) && 'ap-thread-2', isPrivate && 'ap-thread-private', className]} onclick={onopen}>
			<span class="ap-thread-head">
				{#if facesSnippet || faces.length}<span class="ap-thread-faces" aria-hidden="true">{#if facesSnippet}{@render facesSnippet()}{:else}{#each faces as f, i (uid(f) || i)}<Avatar name={f.name || uid(f)} src={f.avatar} size="sm" />{/each}{/if}</span>{/if}
				<!-- The lock leads the title, so its ellipsis never cuts it off. -->
				<span class="ap-thread-name" title={tip}>{#if isPrivate}<Lock class="ap-lock" aria-label="Private" role="img" />{/if}{shown}</span>
				<UnreadCount {unread} {mentions} noun="reply" testid={unreadTestid} />
				{#if lastReply && at.iso}<time class="ap-thread-last" data-testid={lastReplyTestid} datetime={at.iso} title={`Last reply ${at.exact}`}>{lastReply}</time>
				{:else if lastReply}<span class="ap-thread-last" data-testid={lastReplyTestid} title="Last reply">{lastReply}</span>{/if}
			</span>
			<ThreadLines {summary} latest={last} summaryLines={3} {summaryTestid} {latestTestid} />
		</button>
	{/if}
{/snippet}

{#if row}<div class="ap-thread-row">{@render marker()}</div>{:else}{@render marker()}{/if}
