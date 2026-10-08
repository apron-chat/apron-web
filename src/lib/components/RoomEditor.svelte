<script lang="ts">
	import { untrack } from 'svelte';
	import ThreadEditor from '$lib/design/components/ThreadEditor.svelte';
	import type { ChatClient } from '$lib/protocol/client';

	interface Props {
		client: ChatClient;
		/** The room or thread to edit, as it was when the editor opened. */
		room: { id: string; title: string; description?: string };
		/** A thread: its description reads as its summary. */
		thread: boolean;
		/** False while the session can't take requests; the form stays open but won't save. */
		enabled: boolean;
		/** It closed: saved, or put away. */
		onclose: () => void;
	}
	let { client, room, thread, enabled, onclose }: Props = $props();

	// The form starts from the room as it was opened; the caller remounts it per room.
	const initialTitle = untrack(() => room.title);
	const initialDescription = untrack(() => room.description ?? '');
	let open = $state(true);
	let title = $state(initialTitle);
	let description = $state(initialDescription);
	let saving = $state(false);
	let error = $state<string | undefined>();
	let noun = $derived(thread ? 'thread' : 'room');

	/**
	 * Saves the title and description with `room_set` (§4.3.4); an emptied
	 * field is cleared, and `ext`, which the server merges (§4.12), is left as
	 * it is. The
	 * `room_update` that follows is the truth, since a server may alter or
	 * decline.
	 */
	async function save(): Promise<void> {
		if (saving || !enabled) return;
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
		saving = true;
		error = undefined;
		try {
			await client.updateRoom(room.id, patch).promise;
			saving = false;
			open = false;
		} catch (cause) {
			saving = false;
			error = cause instanceof Error ? cause.message : `Unable to save ${noun}`;
		}
	}
</script>

<!-- A centered modal: the design system's ThreadEditor, which edits a room's title and description too. -->
<ThreadEditor bind:open room={!thread} bind:name={title} bind:summary={description} status={saving ? 'saving' : 'idle'} {error} disabled={!enabled} onsubmit={save} {onclose} />
