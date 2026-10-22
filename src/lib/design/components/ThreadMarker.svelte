<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import Lock from '@lucide/svelte/icons/lock';
	import Avatar from './Avatar.svelte';
	import ThreadLines from './ThreadLines.svelte';
	import UnreadCount from './UnreadCount.svelte';
	import type { Sender } from './types';
	import { times, uid } from './util';

	/** Other attributes (`data-*`) go on the card. */
	interface Props extends HTMLAttributes<HTMLElement> {
		/** The thread's `room_id` (a room with `parent_room_id`, §3.4). */
		thread: string;
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
		/** Prefix for `data-testid`s: `<testid>-card` on the card, `-unread`, `-last-reply`, and `-preview` for its lines. */
		testid?: string;
		onopen?: () => void;
	}
	let { thread, name, unread = 0, mentions = 0, private: isPrivate, summary, participants, faces: facesSnippet, lastReply, lastReplyAt, latest, moved, row, testid, onopen, ...rest }: Props = $props();
	const shown = $derived(name || thread);
	const faces = $derived((participants || []).slice(0, 4));
	const last = $derived(latest ? { sender: typeof latest.sender === 'string' ? latest.sender : latest.sender?.name || uid(latest.sender) || '', text: latest.text } : undefined);
	const at = $derived(times(lastReplyAt));
	const id = (suffix: string) => (testid ? `${testid}-${suffix}` : undefined);
</script>

{#snippet marker()}
	{#if moved}
		<div {...rest} class="ap-thread ap-thread-moved" data-testid={id('card')}><span>{'Moved to '}</span><button type="button" class="ap-link" onclick={onopen}>{shown}</button></div>
	{:else}
		<button {...rest} type="button" class={['ap-thread', (summary || last) && 'ap-thread-2', isPrivate && 'ap-thread-private']} data-testid={id('card')} data-thread={thread} onclick={onopen}>
			<span class="ap-thread-head">
				{#if facesSnippet || faces.length}<span class="ap-thread-faces" aria-hidden="true">{#if facesSnippet}{@render facesSnippet()}{:else}{#each faces as f, i (uid(f) || i)}<Avatar name={f.name || uid(f)} src={f.avatar} size="sm" />{/each}{/if}</span>{/if}
				<!-- The lock leads the title, so its ellipsis never cuts it off. -->
				<span class="ap-thread-name">{#if isPrivate}<Lock class="ap-lock" aria-label="Private" role="img" />{/if}{shown}</span>
				<UnreadCount {unread} {mentions} noun="reply" testid={id('unread')} />
				{#if lastReply && at.iso}<time class="ap-thread-last" data-testid={id('last-reply')} datetime={at.iso} title={`Last reply ${at.exact}`}>{lastReply}</time>
				{:else if lastReply}<span class="ap-thread-last" data-testid={id('last-reply')} title="Last reply">{lastReply}</span>{/if}
			</span>
			<ThreadLines {summary} latest={last} summaryLines={3} testid={id('preview')} />
		</button>
	{/if}
{/snippet}

{#if row}<div class="ap-thread-row">{@render marker()}</div>{:else}{@render marker()}{/if}
