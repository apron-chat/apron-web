<script lang="ts">
	import { untrack } from 'svelte';
	import ThreadEditor from '$lib/design/components/ThreadEditor.svelte';
	import type { ChatClient } from '$lib/protocol/client';

	interface Props {
		client: ChatClient;
		/** The room the thread goes under (`parent_room_id`, §3.4). */
		room: { id: string; title: string };
		/** What the form starts with: a suggested title, and the message quoted as the summary. */
		title: string;
		summary: string;
		/** False while the session can't take requests; the form stays open but won't start the thread. */
		enabled: boolean;
		/** The server named the new thread; its record follows in a `room_update`. */
		onstarted: (threadId: string) => void;
		/** It closed: started, or put away. */
		onclose: () => void;
	}
	let { client, room, title: suggestedTitle, summary: suggestedSummary, enabled, onstarted, onclose }: Props = $props();

	// The form starts from what it was opened with; the caller remounts it per message.
	let open = $state(true);
	let title = $state(untrack(() => suggestedTitle));
	let summary = $state(untrack(() => suggestedSummary));
	let saving = $state(false);
	let error = $state<string | undefined>();

	/** Creates the thread under the room with `room_create` (§4.3.4), its summary as the `description`. */
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
			const result = await client.createRoom({ parentRoomId: room.id, title: name, ...(description ? { description } : {}) }).promise;
			if (typeof result.room_id !== 'string' || !result.room_id) throw new Error('Invalid room response');
			saving = false;
			onstarted(result.room_id);
			open = false;
		} catch (cause) {
			saving = false;
			error = cause instanceof Error ? cause.message : 'Unable to start thread';
		}
	}
</script>

<ThreadEditor bind:open mode="start" subtitle="In {room.title}" bind:name={title} bind:summary status={saving ? 'saving' : 'idle'} {error} disabled={!enabled} onsubmit={start} {onclose} />
