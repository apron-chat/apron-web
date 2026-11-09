<script lang="ts">
	import RoomForm from '$lib/design/components/RoomForm.svelte';
	import type { RoomFormField } from '$lib/design/components/types';
	import DescriptionField, { type DescriptionSources } from './DescriptionField.svelte';
	import type { ChatClient } from '$lib/protocol/client';
	import { messageOf, Task } from '$lib/ui/task.svelte';

	interface Props extends DescriptionSources {
		client: ChatClient;
		/** False while creating isn't allowed (capability `rooms`, signed in, not read-only); the form stays open but won't create. */
		enabled: boolean;
		/**
		 * The server named the new room; its record follows in a `room_update`.
		 * `private`: it was asked for as a private room, which its record must
		 * confirm before anything is posted there (§4.2.4). Threads start in a
		 * NewThreadDialog instead.
		 */
		oncreated: (roomId: string, options: { private: boolean }) => void;
		/** It closed: created, or put away. */
		onclose: () => void;
	}
	let { client, enabled, people = [], rooms = [], onmention, oncreated, onclose }: Props = $props();

	// The caller mounts it for each new room, so the form starts empty.
	let open = $state(true);
	let title = $state('');
	let description = $state('');
	let isPrivate = $state(false);
	/** Creating it, and why it wasn't created. */
	const task = new Task<'saving', string>();

	/** Creates the room with `room_set` and no `room_id` (§4.2.4), its description and `private` only when given. */
	async function create(): Promise<void> {
		if (task.busy || !enabled) return;
		const name = title.trim();
		if (!name) {
			task.note = 'Enter a room title.';
			return;
		}
		const about = description.trim();
		const asPrivate = isPrivate;
		let created: string | undefined;
		const worked = await task.run('saving', async () => {
			const result = await client.createRoom({ title: name, ...(about ? { description: about } : {}), ...(asPrivate ? { private: true } : {}) }).promise;
			if (typeof result.room_id !== 'string' || !result.room_id) throw new Error('Invalid room response');
			created = result.room_id;
		}, {
			failed: (cause) => {
				// A server that keeps no private rooms says so (§4.2.4); nothing was created.
				const unsupported = (cause as { code?: number } | undefined)?.code === -32601;
				return asPrivate && unsupported ? 'This server doesn’t keep private rooms. Uncheck Private to create an ordinary room.' : messageOf(cause, 'Unable to create room');
			}
		});
		if (!worked || created === undefined) return;
		oncreated(created, { private: asPrivate });
		open = false;
	}
</script>

<RoomForm bind:open kind="room" mode="create" bind:name={title} field={descriptionField} bind:private={isPrivate} status={task.busy ? 'saving' : 'idle'} error={task.note} disabled={!enabled} onsubmit={create} {onclose} />

{#snippet descriptionField(form: RoomFormField)}
	<DescriptionField bind:value={description} {form} {people} {rooms} {onmention} />
{/snippet}
