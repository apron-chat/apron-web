<script lang="ts">
	import { directory } from '$lib/ui/directory.svelte';
	import { threadPreview, type ThreadEntry } from '$lib/ui/timeline';
	import Lock from '@lucide/svelte/icons/lock';
	import Avatar from './Avatar.svelte';

	/** A thread's card in its parent room: faces, title, count, last reply, and a preview of its description or newest message. */
	let { entry, onopen }: { entry: ThreadEntry; onopen: () => void } = $props();
	let preview = $derived(threadPreview(entry));
</script>

<div class="row">
	<button class="ap-thread" class:ap-thread-2={preview} data-timeline-item data-testid="thread-card" data-thread={entry.id} type="button" onclick={onopen}>
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
			{#if entry.lastReply}<span class="ap-thread-last">Last reply {entry.lastReply}</span>{/if}
		</span>
		{#if preview}
			<span class="ap-thread-preview" class:summary={preview.summary}>
				{#if preview.label}<span class="ap-thread-plabel">{`${preview.label}: `}</span>{/if}<span class="ap-thread-ptext" data-testid="thread-preview">{preview.text}</span>
			</span>
		{/if}
	</button>
</div>

<style>
	.row { margin: var(--space-2) var(--space-4) 0 calc(var(--space-4) + var(--avatar-md) + var(--space-3)); }
	.row .ap-thread { margin-top: 0; }
	.row .ap-thread-head { flex-wrap: wrap; row-gap: 2px; }
	/* A description keeps its line breaks and shows up to three lines; a latest-message preview stays one line. */
	.summary { white-space: normal; }
	.summary .ap-thread-ptext { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden; white-space: pre-wrap; overflow-wrap: anywhere; }
	@media (max-width: 719px) {
		.row { margin-left: var(--space-4); }
	}
</style>
