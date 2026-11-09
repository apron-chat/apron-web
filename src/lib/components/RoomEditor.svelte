<script lang="ts">
	import { untrack } from 'svelte';
	import RoomForm from '$lib/design/components/RoomForm.svelte';
	import type { RoomFormField } from '$lib/design/components/types';
	import DescriptionField, { type DescriptionSources } from './DescriptionField.svelte';
	import type { ChatClient } from '$lib/protocol/client';
	import { messageOf, Task } from '$lib/ui/task.svelte';

	interface Props extends DescriptionSources {
		client: ChatClient;
		/** The room or thread to edit, as it was when the editor opened. */
		room: { id: string; title: string; description?: string };
		/** A thread, not a room: named as one in the form. */
		thread: boolean;
		/** False while the session can't take requests; the form stays open but won't save. */
		enabled: boolean;
		/** It closed: saved, or put away. */
		onclose: () => void;
	}
	let { client, room, thread, enabled, people = [], rooms = [], onmention, onclose }: Props = $props();

	// The form starts from the room as it was opened; the caller remounts it per room.
	const initialTitle = untrack(() => room.title);
	const initialDescription = untrack(() => room.description ?? '');
	let open = $state(true);
	let title = $state(initialTitle);
	let description = $state(initialDescription);
	/** Saving it, and why it didn't save. */
	const task = new Task<'saving', string>();
	let noun = $derived(thread ? 'thread' : 'room');

	/**
	 * Saves the title and description with `room_set` (§4.2.4); an emptied
	 * field is cleared, and `ext`, which the server merges (§4.12), is left as
	 * it is. The
	 * `room_update` that follows is the truth, since a server may alter or
	 * decline.
	 */
	async function save(): Promise<void> {
		if (task.busy || !enabled) return;
		const nextTitle = title.trim();
		const nextDescription = description.trim();
		const patch = {
			...(nextTitle !== initialTitle ? { title: nextTitle || null } : {}),
			...(nextDescription !== initialDescription.trim() ? { description: nextDescription || null } : {})
		};
		if (!Object.keys(patch).length) {
			open = false;
			return;
		}
		if (await task.run('saving', () => client.updateRoom(room.id, patch).promise, { failed: (cause) => messageOf(cause, `Unable to save ${noun}`) })) open = false;
	}
</script>

<RoomForm bind:open kind={thread ? 'thread' : 'room'} mode="edit" bind:name={title} field={descriptionField} status={task.busy ? 'saving' : 'idle'} error={task.note} disabled={!enabled} onsubmit={save} {onclose} />

{#snippet descriptionField(form: RoomFormField)}
	<DescriptionField bind:value={description} {form} {people} {rooms} {onmention} />
{/snippet}
