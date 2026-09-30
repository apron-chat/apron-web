<script lang="ts">
	import { untrack } from 'svelte';
	import type { ChatClient } from '$lib/protocol/client';

	interface Props {
		client: ChatClient;
		/** The room or thread to edit, as it was when the editor opened. */
		room: { id: string; title: string; description?: string };
		/** A thread: its description reads as its summary. */
		thread: boolean;
		/** False while the session can't take requests; the form stays open but won't save. */
		enabled: boolean;
		onclose: () => void;
	}
	let { client, room, thread, enabled, onclose }: Props = $props();

	// The form starts from the room as it was opened; the caller remounts it per room.
	const initialTitle = untrack(() => room.title);
	const initialDescription = untrack(() => room.description ?? '');
	let title = $state(initialTitle);
	let description = $state(initialDescription);
	let saving = $state(false);
	let error = $state<string | undefined>();
	let noun = $derived(thread ? 'thread' : 'room');

	/**
	 * Saves the title and description with `room_set` (§4.3.4), which
	 * resubmits `ext` unchanged; an emptied field is cleared. The
	 * `room_update` that follows is the truth, since a server may alter or
	 * decline.
	 */
	async function save(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (saving || !enabled) return;
		const nextTitle = title.trim();
		const nextDescription = description.trim();
		const patch = {
			...(nextTitle !== initialTitle ? { title: nextTitle || null } : {}),
			...(nextDescription !== initialDescription.trim() ? { description: nextDescription || null } : {})
		};
		if (!Object.keys(patch).length) {
			onclose();
			return;
		}
		saving = true;
		error = undefined;
		try {
			await client.updateRoom(room.id, patch).promise;
			onclose();
		} catch (cause) {
			saving = false;
			error = cause instanceof Error ? cause.message : `Unable to save ${noun}`;
		}
	}
</script>

<section class="ap-roomhead-pop" aria-label="Edit {noun}">
	<form class="ap-tedit" onsubmit={save}>
		<label class="ap-fieldlabel">Title
			<input class="ap-field" aria-label="{thread ? 'Thread' : 'Room'} title" bind:value={title} disabled={saving} maxlength="120" />
		</label>
		<label class="ap-fieldlabel"><span class="ap-fieldlabel-row">{thread ? 'Summary' : 'Description'}<span class="ap-fieldlabel-hint">Markdown</span></span>
			<textarea class="ap-field ap-field-multi" aria-label="{thread ? 'Thread summary' : 'Room description'}" rows="4" bind:value={description} disabled={saving} spellcheck="true"
				placeholder={thread ? 'What this thread is about, or what it settled.' : 'What this room is for.'}></textarea>
		</label>
		{#if error}<p class="ap-profedit-note ap-profedit-err" role="alert">{error}</p>{/if}
		<div class="ap-profedit-actions">
			<button class="ap-btn ap-btn-ghost ap-btn-sm" type="button" disabled={saving} onclick={onclose}>Cancel</button>
			<button class="ap-btn ap-btn-primary ap-btn-sm" type="submit" aria-label="Save {noun}" disabled={saving || !enabled}>{saving ? 'Saving…' : 'Save'}</button>
		</div>
	</form>
</section>

<style>
	@media (max-width: 719px) {
		.ap-roomhead-pop { left: var(--space-4); }
	}
</style>
