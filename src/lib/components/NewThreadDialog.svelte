<script lang="ts">
	import { untrack } from 'svelte';
	import RoomForm from '$lib/design/components/RoomForm.svelte';
	import type { RoomFormField } from '$lib/design/components/types';
	import DescriptionField, { type DescriptionSources } from './DescriptionField.svelte';
	import { messageOf, Task } from '$lib/ui/task.svelte';

	interface Props extends DescriptionSources {
		/** The room the thread goes under (`parent_room_id`, §3.4); a thread of a private room is private too (§4.2.4). */
		room: { id: string; title: string; private?: boolean };
		/**
		 * What the form starts with: empty from a room, or suggested from the message(s) it's started on. A suggested
		 * description waits behind "Add description" like an empty one, so it isn't taken for the first message, and is
		 * sent only once it's shown.
		 */
		title?: string;
		description?: string;
		/** Started on a message: the name of who wrote it. The first message is then a reply to it, behind "Add reply". */
		replyTo?: string;
		/** Selected messages that move into the thread once it exists. */
		moving?: number;
		/** False while the session can't take requests; the form stays open but won't start the thread. */
		enabled: boolean;
		/**
		 * Creates the thread with what was entered (the description as its `description`, left out when empty or never
		 * shown), and the first message written, if any, with who it mentions, to send in it. Its rejection is shown in
		 * the form, which stays open to try again; once it resolves, the form closes.
		 */
		oncreate: (thread: { title: string; description?: string }, first?: { text: string; mentions: string[] }) => Promise<void>;
		/** It closed: started, or put away. */
		onclose: () => void;
	}
	let { room, title: suggestedTitle = '', description: suggestedDescription = '', replyTo, moving = 0, enabled, people = [], rooms = [], onmention, oncreate, onclose }: Props = $props();

	// The form starts from what it was opened with; the caller remounts it for each new thread.
	let open = $state(true);
	let title = $state(untrack(() => suggestedTitle));
	let description = $state(untrack(() => suggestedDescription));
	/** Put away until "Add description" (RoomForm's choice for a thread), even with a suggestion in it. */
	let showDescription = $state<boolean | undefined>();
	let firstMessage = $state('');
	let firstMentions = $state<string[]>([]);
	let showFirstMessage = $state(false);
	/** Removed by its ×, a field starts over: empty, or the description with its suggestion. */
	function setShowDescription(show: boolean | undefined): void {
		if (!show) description = suggestedDescription;
		showDescription = show;
	}
	function setShowFirstMessage(show: boolean): void {
		if (!show) {
			firstMessage = '';
			firstMentions = [];
		}
		showFirstMessage = show;
	}
	/** Starting it, and why it didn't start. */
	const task = new Task<'saving', string>();

	async function start(): Promise<void> {
		if (task.busy || !enabled) return;
		const name = title.trim();
		if (!name) {
			task.note = 'Enter a thread title.';
			return;
		}
		const text = showDescription ? description.trim() : '';
		const first = !moving && showFirstMessage && firstMessage.trim() ? { text: firstMessage.trim(), mentions: firstMentions } : undefined;
		if (await task.run('saving', () => oncreate({ title: name, ...(text ? { description: text } : {}) }, first), { failed: (cause) => messageOf(cause, 'Unable to start thread') })) open = false;
	}
</script>

<RoomForm bind:open kind="thread" subtitle="In {room.title}" private={room.private === true} {moving} {replyTo} bind:showDescription={() => showDescription, setShowDescription} bind:showFirstMessage={() => showFirstMessage, setShowFirstMessage} bind:name={title} field={descriptionField} firstMessage={firstMessageField} status={task.busy ? 'saving' : 'idle'} error={task.note} disabled={!enabled} onsubmit={start} {onclose} />

{#snippet descriptionField(form: RoomFormField)}
	<DescriptionField bind:value={description} {form} {people} {rooms} {onmention} />
{/snippet}
{#snippet firstMessageField(form: RoomFormField)}
	<DescriptionField bind:value={firstMessage} bind:mentions={firstMentions} {form} {people} {rooms} {onmention} formatting={false} testid="first-message" />
{/snippet}
