<script lang="ts">
	import ThreadMarker from '$lib/design/components/ThreadMarker.svelte';
	import { minuteNow } from '$lib/ui/clock.svelte';
	import { directory } from '$lib/ui/directory.svelte';
	import { designTitle, threadLatest, threadSummaryText, type ThreadEntry } from '$lib/ui/timeline';
	import { idMillis, idSince } from '$lib/ui/time';
	import Avatar from '$lib/design/components/Avatar.svelte';
	import { hueOf } from '$lib/ui/messages';

	/** A thread's card in its parent room: faces, title (ellipsized), what's new in it and when it was last replied to (at the right), all on one row, then its summary (in plum when it's private) and newest message, as its sidebar row shows them. */
	let { entry, unread = 0, mentions = 0, onopen }: {
		entry: ThreadEntry;
		/** Its unread replies and mentions of you, as the sidebar counts them; only known for a thread you've joined. */
		unread?: number;
		mentions?: number;
		onopen: () => void;
	} = $props();
	let summary = $derived(threadSummaryText(entry));
	let latest = $derived(threadLatest(entry));
	let since = $derived(entry.lastReplyId !== undefined ? idSince(entry.lastReplyId, minuteNow()) : '');
</script>

<!-- The design system's ThreadMarker, on a row of its own; the app fills in the faces, hued by user ID as everywhere else. -->
{#snippet faces()}
	{#each entry.participants as participant (participant.user_id)}
		<Avatar name={directory.name(participant)} hue={hueOf(directory.person(participant)?.user_id)} src={directory.avatar(participant)} size="sm" />
	{/each}
{/snippet}

<ThreadMarker
	row timelineItem testid="thread-card" thread={entry.id} name={designTitle(entry)} private={entry.private} {unread} {mentions}
	faces={entry.participants.length > 0 ? faces : undefined} {summary} {latest} lastReply={since || undefined} lastReplyAt={idMillis(entry.lastReplyId ?? '')} {onopen}
	unreadTestid="thread-unread" lastReplyTestid="thread-last-reply" summaryTestid="thread-preview-summary" latestTestid="thread-preview-latest"
/>
