<script lang="ts">
	import { untrack } from 'svelte';
	import RoomForm from '$lib/design/components/RoomForm.svelte';
	import { messageOf, Task } from '$lib/ui/task.svelte';

	interface Props {
		/** The room the thread goes under (`parent_room_id`, §3.4); a thread of a private room is private too (§4.2.4). */
		room: { id: string; title: string; private?: boolean };
		/** What the form starts with: empty from a room, or suggested from the message(s) it starts from. */
		title?: string;
		description?: string;
		/** Selected messages that move into the thread once it exists. */
		moving?: number;
		/** False while the session can't take requests; the form stays open but won't start the thread. */
		enabled: boolean;
		/**
		 * Creates the thread with what was entered (the description as its `description`, left out when empty). Its
		 * rejection is shown in the form, which stays open to try again; once it resolves, the form closes.
		 */
		oncreate: (thread: { title: string; description?: string }) => Promise<void>;
		/** It closed: started, or put away. */
		onclose: () => void;
	}
	let { room, title: suggestedTitle = '', description: suggestedDescription = '', moving = 0, enabled, oncreate, onclose }: Props = $props();

	// The form starts from what it was opened with; the caller remounts it for each new thread.
	let open = $state(true);
	let title = $state(untrack(() => suggestedTitle));
	let description = $state(untrack(() => suggestedDescription));
	/** Starting it, and why it didn't start. */
	const task = new Task<'saving', string>();

	async function start(): Promise<void> {
		if (task.busy || !enabled) return;
		const name = title.trim();
		if (!name) {
			task.note = 'Enter a thread title.';
			return;
		}
		const text = description.trim();
		if (await task.run('saving', () => oncreate({ title: name, ...(text ? { description: text } : {}) }), { failed: (cause) => messageOf(cause, 'Unable to start thread') })) open = false;
	}
</script>

<RoomForm bind:open kind="thread" mode="create" subtitle="In {room.title}" private={room.private === true} {moving} bind:name={title} bind:description status={task.busy ? 'saving' : 'idle'} error={task.note} disabled={!enabled} onsubmit={start} {onclose} />
