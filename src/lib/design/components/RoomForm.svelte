<script lang="ts">
	import { tick } from 'svelte';
	import Button from './Button.svelte';
	import Dialog from './Dialog.svelte';

	interface Props {
		/** Shown as a centered modal while true; bindable, and set false however it closes. */
		open?: boolean;
		/** A room (title and description), or a thread (title and summary): a room with a `parent_room_id` (§3.4). */
		kind?: 'room' | 'thread';
		/**
		 * `create` a room or start a thread (`room_create`, §4.3.4), or `edit` an existing one (`room_set`). A thread
		 * starts from its room, from a message (its text quoted as the summary), or from selected messages.
		 */
		mode?: 'create' | 'edit';
		/** One line under the heading, such as the room a new thread goes in. */
		subtitle?: string;
		/**
		 * Private (§4.3.4), when creating. A room: the Private choice, `bind:private`. A thread takes its room's,
		 * so it's no choice: a note says so. Editing ignores it, since an omitted `private` is kept.
		 */
		private?: boolean;
		/** Starting a thread for this many selected messages, which move into it: said in the heading, a note and the button. */
		moving?: number;
		/** Title. `bind:name`. Focused when it opens; selected too when creating, so typing replaces a suggestion. */
		name?: string;
		/** The `description`, Markdown: a room's description, a thread's summary. `bind:summary`. */
		summary?: string;
		status?: 'idle' | 'saving';
		/** What went wrong: a missing title, or the server declining. */
		error?: string;
		/** The session can't take requests: the form stays open but won't submit. */
		disabled?: boolean;
		onsubmit?: () => void;
		/** It closed, whichever way: Cancel, Escape, the close button. */
		onclose?: () => void;
	}
	let { open = $bindable(false), kind = 'thread', mode = 'edit', subtitle, private: isPrivate = $bindable(false), moving = 0, name = $bindable(''), summary = $bindable(''), status = 'idle', error, disabled = false, onsubmit, onclose }: Props = $props();
	const uid = $props.id();
	const saving = $derived(status === 'saving');
	const creating = $derived(mode === 'create');
	const thread = $derived(kind === 'thread');
	const moves = $derived(creating && thread ? moving : 0);
	const heading = $derived(!creating ? `Edit ${kind}` : !thread ? 'Create a room' : moves ? 'Move to a new thread' : 'Start thread');
	const action = $derived(!creating ? (saving ? 'Saving…' : 'Save')
		: !thread ? (saving ? 'Creating…' : 'Create room')
		: moves ? (saving ? 'Moving…' : `Move ${moves === 1 ? 'message' : `${moves} messages`}`)
		: (saving ? 'Starting…' : 'Start thread'));
	/** What starting a thread will do, in a line under the fields. */
	const note = $derived(creating && thread ? [
		moves ? `${moves === 1 ? 'The selected message moves' : `The ${moves} selected messages move`} into the new thread.` : '',
		isPrivate ? 'Private, like its room: only the room’s members see it.' : ''
	].filter(Boolean).join(' ') : '');
	let nameInput = $state<HTMLInputElement | undefined>();

	$effect(() => {
		if (!open) return;
		void tick().then(() => {
			nameInput?.focus();
			if (creating) nameInput?.select();
		});
	});
</script>

<!-- Escape, the close button and Cancel do nothing while it saves. -->
<Dialog bind:open size="md" title={heading} {subtitle} locked={saving} testid="room-form" {onclose}
	onsubmit={(event) => { event.preventDefault(); if (!saving && !disabled) onsubmit?.(); }}>
	<label class="ap-fieldlabel" for="{uid}-name">Title
		<input id="{uid}-name" class="ap-field" aria-label="{thread ? 'Thread' : 'Room'} title" aria-required={creating} bind:this={nameInput} bind:value={name} disabled={saving} maxlength="120" autocomplete="off" spellcheck="true"
			placeholder={creating ? (thread ? 'What it’s about' : 'What to call it') : ''} />
	</label>
	<label class="ap-fieldlabel" for="{uid}-summary"><span class="ap-fieldlabel-row"><span>{thread ? 'Summary' : 'Description'}</span><span class="ap-fieldlabel-hint">Markdown{creating ? ', optional' : ''}</span></span>
		<textarea id="{uid}-summary" class="ap-field ap-field-multi" aria-label={thread ? 'Thread summary' : 'Room description'} rows={creating && !summary ? 4 : 8} bind:value={summary} disabled={saving} spellcheck="true"
			placeholder={thread ? 'What this thread is about, or what it settled. Shows on its card and at the top of the thread.' : 'What this room is for.'}></textarea>
	</label>
	{#if creating && !thread}
		<label class={['ap-choice-item', 'ap-checklist-item', isPrivate && 'ap-choice-on']}>
			<input class="ap-checklist-box" type="checkbox" bind:checked={isPrivate} disabled={saving} />
			<span class="ap-checklist-label"><span class="ap-choice-title">Private</span><span class="ap-choice-text">Only members see it, and members add others.</span></span>
		</label>
	{/if}
	{#if note}<p class="ap-roomform-note">{note}</p>{/if}
	{#if error}<p class="ap-profedit-note ap-profedit-err" role="alert">{error}</p>{/if}
	{#snippet footer()}
		<Button variant="ghost" size="sm" onclick={() => (open = false)} disabled={saving} label="Cancel" />
		<Button type="submit" variant="primary" size="sm" disabled={saving || disabled} label={action} />
	{/snippet}
</Dialog>
