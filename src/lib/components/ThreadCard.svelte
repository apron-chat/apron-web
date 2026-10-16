<script lang="ts">
	import ThreadLines from '$lib/design/components/ThreadLines.svelte';
	import { minuteNow } from '$lib/ui/clock.svelte';
	import { directory } from '$lib/ui/directory.svelte';
	import { threadLatest, threadSummaryText, type ThreadEntry } from '$lib/ui/timeline';
	import { idDateTime, idIso, idSince } from '$lib/ui/time';
	import Lock from '@lucide/svelte/icons/lock';
	import Avatar from './Avatar.svelte';

	/** A thread's card in its parent room: faces, title, count, when it was last replied to (at the right), then its summary and newest message, as its sidebar row shows them. */
	let { entry, onopen }: { entry: ThreadEntry; onopen: () => void } = $props();
	let summary = $derived(threadSummaryText(entry));
	let latest = $derived(threadLatest(entry));
	let since = $derived(entry.lastReplyId !== undefined ? idSince(entry.lastReplyId, minuteNow()) : '');
</script>

<div class="row">
	<button class="ap-thread" class:ap-thread-2={summary || latest} data-timeline-item data-testid="thread-card" data-thread={entry.id} type="button" onclick={onopen}>
		<span class="ap-thread-head">
			{#if entry.participants.length > 0}
				<span class="ap-thread-faces" aria-hidden="true">
					{#each entry.participants as participant (participant.user_id)}
						<Avatar name={directory.name(participant)} id={directory.person(participant)?.user_id} src={directory.avatar(participant)} size="sm" />
					{/each}
				</span>
			{/if}
			<span class="ap-thread-name">{entry.title}{#if entry.private}<Lock class="ap-lock" aria-label="Private" role="img" />{/if}</span>
			{#if entry.count !== undefined}<span class="ap-thread-count">{entry.count} {entry.count === 1 ? 'message' : 'messages'}</span>{/if}
			{#if since}<time class="ap-thread-last" data-testid="thread-last-reply" datetime={idIso(entry.lastReplyId ?? '')} title={`Last reply ${idDateTime(entry.lastReplyId ?? '')}`}>{since}</time>{/if}
		</span>
		<ThreadLines {summary} {latest} summaryLines={3} testid="thread-preview" />
	</button>
</div>

<style>
	.row { margin: var(--space-2) var(--space-4) 0 calc(var(--space-4) + var(--avatar-md) + var(--space-3)); }
	.row .ap-thread { margin-top: 0; }
	.row .ap-thread-head { flex-wrap: wrap; row-gap: 2px; }
	@media (max-width: 719px) {
		.row { margin-left: var(--space-4); }
	}
</style>
