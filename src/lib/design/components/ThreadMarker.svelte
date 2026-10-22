<script lang="ts">
	import Avatar from './Avatar.svelte';
	import ThreadLines from './ThreadLines.svelte';
	import UnreadCount from './UnreadCount.svelte';
	import type { Sender } from './types';
	import { uid } from './util';

	interface Props {
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
		/** Pre-formatted time of the newest message, compact within two weeks: "9h", "12d", then "14 Sep"; shown at the right, unlabelled. */
		lastReply?: string;
		/** The newest message, on the line after the summary (up to three lines). Shorten `text` yourself. */
		latest?: { sender: Sender; text: string };
		/** Render the "Moved to …" marker where a moved message used to be. */
		moved?: boolean;
		onopen?: () => void;
	}
	let { thread, name, unread = 0, mentions = 0, private: isPrivate, summary, participants, lastReply, latest, moved, onopen }: Props = $props();
	const shown = $derived(name || thread);
	const faces = $derived((participants || []).slice(0, 4));
	const last = $derived(latest ? { sender: latest.sender?.name || uid(latest.sender) || '', text: latest.text } : undefined);
</script>

{#if moved}
	<div class="ap-thread ap-thread-moved"><span>{'Moved to '}</span><button type="button" class="ap-link" onclick={onopen}>{shown}</button></div>
{:else}
	<button type="button" class={['ap-thread', (summary || last) && 'ap-thread-2', isPrivate && 'ap-thread-private']} onclick={onopen}>
		<span class="ap-thread-head">
			{#if faces.length}<span class="ap-thread-faces" aria-hidden="true">{#each faces as f, i (uid(f) || i)}<Avatar name={f.name || uid(f)} src={f.avatar} size="sm" />{/each}</span>{/if}
			<span class="ap-thread-name">{#if isPrivate}<svg class="ap-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Private"><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>{/if}{shown}</span>
			<UnreadCount {unread} {mentions} noun="reply" />
			{#if lastReply}<span class="ap-thread-last" title="Last reply">{lastReply}</span>{/if}
		</span>
		<ThreadLines {summary} latest={last} summaryLines={3} />
	</button>
{/if}
