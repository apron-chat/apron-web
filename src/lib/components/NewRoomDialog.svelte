<script lang="ts">
	import RoomForm from '$lib/design/components/RoomForm.svelte';
	import type { ChatClient } from '$lib/protocol/client';

	interface Props {
		client: ChatClient;
		/** False while creating isn't allowed (capability `rooms`, signed in, not read-only); the form stays open but won't create. */
		enabled: boolean;
		/**
		 * The server named the new room; its record follows in a `room_update`.
		 * `private`: it was asked for as a private room, which its record must
		 * confirm before anything is posted there (§4.3.4). Threads start in a
		 * NewThreadDialog instead.
		 */
		oncreated: (roomId: string, options: { private: boolean }) => void;
		/** It closed: created, or put away. */
		onclose: () => void;
	}
	let { client, enabled, oncreated, onclose }: Props = $props();

	// The caller mounts it for each new room, so the form starts empty.
	let open = $state(true);
	let title = $state('');
	let description = $state('');
	let isPrivate = $state(false);
	let saving = $state(false);
	let error = $state<string | undefined>();

	/** Creates the room with `room_create` (§4.3.4), its description and `private` only when given. */
	async function create(): Promise<void> {
		if (saving || !enabled) return;
		const name = title.trim();
		if (!name) {
			error = 'Enter a room title.';
			return;
		}
		const about = description.trim();
		const asPrivate = isPrivate;
		saving = true;
		error = undefined;
		try {
			const result = await client.createRoom({ title: name, ...(about ? { description: about } : {}), ...(asPrivate ? { private: true } : {}) }).promise;
			if (typeof result.room_id !== 'string' || !result.room_id) throw new Error('Invalid room response');
			saving = false;
			oncreated(result.room_id, { private: asPrivate });
			open = false;
		} catch (cause) {
			saving = false;
			// A server that keeps no private rooms says so (§4.3.4); nothing was created.
			const unsupported = (cause as { code?: number } | undefined)?.code === -32601;
			error = asPrivate && unsupported ? 'This server doesn’t keep private rooms. Uncheck Private to create an ordinary room.'
				: cause instanceof Error ? cause.message : 'Unable to create room';
		}
	}
</script>

<RoomForm bind:open kind="room" mode="create" bind:name={title} bind:summary={description} bind:private={isPrivate} status={saving ? 'saving' : 'idle'} {error} disabled={!enabled} onsubmit={create} {onclose} />
