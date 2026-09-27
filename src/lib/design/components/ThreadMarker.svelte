<script lang="ts">
	import Avatar from './Avatar.svelte';
	import type { Sender } from './types';
	import { cx, uid } from './util';

	interface Props {
		/** The thread's `room_id` (a room with `parent_room_id`, §3.4). */
		thread: string;
		name?: string;
		count?: number;
		/** The thread's `intro_message` text, when it's a written summary rather than the message that started it. */
		summary?: string;
		/** The thread's members or recent senders, most recent first; up to 4 are shown. */
		participants?: Sender[];
		/** Pre-formatted time of the newest message, e.g. "14:32". */
		lastReply?: string;
		/** The newest message, shown as the preview line when there is no summary. Shorten `text` yourself. */
		latest?: { sender: Sender; text: string };
		/** Render the "Moved to …" marker where a moved message used to be. */
		moved?: boolean;
		onopen?: () => void;
	}
	let { thread, name, count, summary, participants, lastReply, latest, moved, onopen }: Props = $props();
	const shown = $derived(name || thread);
	const faces = $derived((participants || []).slice(0, 4));
	const preview = $derived(summary ? { label: 'Summary', text: summary } : latest ? { label: latest.sender?.name || uid(latest.sender) || '', text: latest.text } : null);
</script>

{#if moved}
	<div class="ap-thread ap-thread-moved"><span>{'Moved to '}</span><button type="button" class="ap-link" onclick={onopen}>{shown}</button></div>
{:else}
	<button type="button" class={cx('ap-thread', preview && 'ap-thread-2')} onclick={onopen}>
		<span class="ap-thread-head">
			{#if faces.length}<span class="ap-thread-faces" aria-hidden="true">{#each faces as f, i (uid(f) || i)}<Avatar name={f.name || uid(f)} src={f.avatar} size="sm" />{/each}</span>{/if}
			<span class="ap-thread-name">{shown}</span>
			{#if count != null}<span class="ap-thread-count">{count}{count === 1 ? ' reply' : ' replies'}</span>{/if}
			{#if lastReply}<span class="ap-thread-last">Last reply {lastReply}</span>{/if}
		</span>
		{#if preview}
			<span class="ap-thread-preview">{#if preview.label}<span class="ap-thread-plabel">{preview.label + ': '}</span>{/if}<span class="ap-thread-ptext">{preview.text}</span></span>
		{/if}
	</button>
{/if}
