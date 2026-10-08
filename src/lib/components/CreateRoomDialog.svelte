<script lang="ts">
	import { tick, untrack } from 'svelte';
	import Dialog from '$lib/design/components/Dialog.svelte';
	import type { ChatClient } from '$lib/protocol/client';

	interface Props {
		client: ChatClient;
		open?: boolean;
		/** Creating is allowed (capability `rooms`, signed in, not read-only); losing that closes the dialog. */
		enabled: boolean;
		/**
		 * The server named the new room; its record follows in a `room_update`.
		 * `private`: it was asked for as a private room, which its record must
		 * confirm before anything is posted there (§4.3.4). Threads start in a
		 * NewThreadDialog instead.
		 */
		oncreated: (roomId: string, options: { private: boolean }) => void;
	}
	let { client, open = $bindable(false), enabled, oncreated }: Props = $props();
	const id = $props.id();

	let titleInput = $state<HTMLInputElement | undefined>();
	let title = $state('');
	let description = $state('');
	let isPrivate = $state(false);
	let creating = $state(false);
	let error = $state('');

	$effect(() => {
		if (open && !enabled) open = false;
	});

	/** Each time it opens, the form starts empty, with the name focused. */
	$effect(() => {
		if (!open) return;
		untrack(() => {
			title = '';
			description = '';
			isPrivate = false;
			error = '';
		});
		void tick().then(() => titleInput?.focus());
	});

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const name = title.trim();
		if (!name) {
			error = 'Enter a room name.';
			return;
		}
		if (!enabled || creating) return;
		creating = true;
		error = '';
		const about = description.trim();
		try {
			const result = await client.createRoom({ title: name, ...(about ? { description: about } : {}), ...(isPrivate ? { private: true } : {}) }).promise;
			if (typeof result.room_id !== 'string' || !result.room_id) throw new Error('Invalid room response');
			oncreated(result.room_id, { private: isPrivate });
			open = false;
		} catch (cause) {
			// A server that keeps no private rooms says so (§4.3.4); nothing was created.
			const unsupported = (cause as { code?: number } | undefined)?.code === -32601;
			error = isPrivate && unsupported ? 'This server doesn’t keep private rooms. Uncheck Private to create an ordinary room.'
				: cause instanceof Error ? cause.message : 'Unable to create room';
		} finally {
			creating = false;
		}
	}
</script>

<!-- Escape, the close button and Cancel do nothing while the room is being created. -->
<Dialog bind:open title="Create a room" locked={creating} onsubmit={submit}>
	<label class="ap-fieldlabel" for="{id}-name">Room name
		<input id="{id}-name" class="ap-field" bind:this={titleInput} bind:value={title} autocomplete="off" required disabled={creating} />
	</label>
	<label class="ap-fieldlabel" for="{id}-description">
		<span class="ap-fieldlabel-row"><span>Description</span><span class="ap-fieldlabel-hint">Markdown, optional</span></span>
		<textarea id="{id}-description" class="ap-field ap-field-multi" rows="3" bind:value={description} disabled={creating} placeholder="What this room is for."></textarea>
	</label>
	<label class="ap-choice-item ap-checklist-item" class:ap-choice-on={isPrivate}>
		<input class="ap-checklist-box" type="checkbox" bind:checked={isPrivate} disabled={creating} />
		<span class="ap-checklist-label"><span class="ap-choice-title">Private</span><span class="ap-choice-text">Only members see it, and members add others.</span></span>
	</label>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#snippet footer()}
		<button class="ap-btn ap-btn-ghost ap-btn-sm" type="button" disabled={creating} onclick={() => (open = false)}>Cancel</button>
		<button class="ap-btn ap-btn-primary ap-btn-sm" type="submit" disabled={creating}>{creating ? 'Creating…' : 'Create room'}</button>
	{/snippet}
</Dialog>

<style>
	.error { margin: 0; color: var(--danger); font-size: var(--text-ui); line-height: 18px; }
</style>
