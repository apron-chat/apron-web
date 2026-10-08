<script lang="ts">
	import { untrack } from 'svelte';
	import ThreadEditor from '$lib/design/components/ThreadEditor.svelte';

	interface Props {
		/** The room the thread goes under (`parent_room_id`, §3.4); a thread of a private room is private too (§4.3.4). */
		room: { id: string; title: string; private?: boolean };
		/** What the form starts with: empty from a room, or suggested from the message(s) it starts from. */
		title?: string;
		summary?: string;
		/** Selected messages that move into the thread once it exists. */
		moving?: number;
		/** False while the session can't take requests; the form stays open but won't start the thread. */
		enabled: boolean;
		/**
		 * Creates the thread with what was entered (the summary as its `description`, left out when empty). Its
		 * rejection is shown in the form, which stays open to try again; once it resolves, the form closes.
		 */
		oncreate: (thread: { title: string; description?: string }) => Promise<void>;
		/** It closed: started, or put away. */
		onclose: () => void;
	}
	let { room, title: suggestedTitle = '', summary: suggestedSummary = '', moving = 0, enabled, oncreate, onclose }: Props = $props();

	// The form starts from what it was opened with; the caller remounts it for each new thread.
	let open = $state(true);
	let title = $state(untrack(() => suggestedTitle));
	let summary = $state(untrack(() => suggestedSummary));
	let saving = $state(false);
	let error = $state<string | undefined>();

	async function start(): Promise<void> {
		if (saving || !enabled) return;
		const name = title.trim();
		if (!name) {
			error = 'Enter a thread title.';
			return;
		}
		const description = summary.trim();
		saving = true;
		error = undefined;
		try {
			await oncreate({ title: name, ...(description ? { description } : {}) });
			saving = false;
			open = false;
		} catch (cause) {
			saving = false;
			error = cause instanceof Error ? cause.message : 'Unable to start thread';
		}
	}
</script>

<ThreadEditor bind:open mode="start" subtitle="In {room.title}" private={room.private === true} {moving} bind:name={title} bind:summary status={saving ? 'saving' : 'idle'} {error} disabled={!enabled} onsubmit={start} {onclose} />
