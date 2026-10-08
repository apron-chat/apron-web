<script lang="ts">
	import { tick } from 'svelte';
	import Button from './Button.svelte';
	import Dialog from './Dialog.svelte';

	interface Props {
		/** Shown as a centered modal while true; bindable, and set false however it closes. */
		open?: boolean;
		/**
		 * `edit` an existing thread or room (`room_set`, §4.3.4), or `start` a new thread (`room_create` with
		 * `parent_room_id`): from a room, from a message (its text quoted as the summary), or from selected messages.
		 */
		mode?: 'edit' | 'start';
		/** A room's title and description rather than a thread's title and summary (`edit` only). */
		room?: boolean;
		/** One line under the heading, such as the room a new thread goes in. */
		subtitle?: string;
		/** The thread is private, as a thread of a private room is (§4.3.4): a note says so when starting. */
		private?: boolean;
		/** Starting a thread for this many selected messages, which move into it: said in a note and on the button. */
		moving?: number;
		/** Title. `bind:name`. Focused when it opens; selected too when starting, so typing replaces a suggestion. */
		name?: string;
		/** Summary: the thread's `description`, Markdown. `bind:summary`. */
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
	let { open = $bindable(false), mode = 'edit', room = false, subtitle, private: isPrivate = false, moving = 0, name = $bindable(''), summary = $bindable(''), status = 'idle', error, disabled = false, onsubmit, onclose }: Props = $props();
	const uid = $props.id();
	const saving = $derived(status === 'saving');
	const starting = $derived(mode === 'start');
	const noun = $derived(room && !starting ? 'room' : 'thread');
	const heading = $derived(starting ? (moving ? 'Move to a new thread' : 'Start thread') : `Edit ${noun}`);
	const action = $derived(starting ? (moving ? (saving ? 'Moving…' : `Move ${moving === 1 ? 'message' : `${moving} messages`}`) : (saving ? 'Starting…' : 'Start thread')) : (saving ? 'Saving…' : 'Save'));
	/** What starting it will do, in a line under the fields. */
	const note = $derived(starting ? [
		moving ? `${moving === 1 ? 'The selected message moves' : `The ${moving} selected messages move`} into the new thread.` : '',
		isPrivate ? 'Private, like its room: only the room’s members see it.' : ''
	].filter(Boolean).join(' ') : '');
	let nameInput = $state<HTMLInputElement | undefined>();

	$effect(() => {
		if (!open) return;
		void tick().then(() => {
			nameInput?.focus();
			if (starting) nameInput?.select();
		});
	});
</script>

<!-- Escape, the close button and Cancel do nothing while it saves. -->
<Dialog bind:open size="md" title={heading} {subtitle} locked={saving} testid="thread-editor" {onclose}
	onsubmit={(event) => { event.preventDefault(); if (!saving && !disabled) onsubmit?.(); }}>
	<label class="ap-fieldlabel" for="{uid}-name">Title
		<input id="{uid}-name" class="ap-field" aria-label="{noun === 'room' ? 'Room' : 'Thread'} title" aria-required={starting} bind:this={nameInput} bind:value={name} disabled={saving} maxlength="120" autocomplete="off" spellcheck="true"
			placeholder={starting ? 'What it’s about' : ''} />
	</label>
	<label class="ap-fieldlabel" for="{uid}-summary"><span class="ap-fieldlabel-row"><span>{noun === 'room' ? 'Description' : 'Summary'}</span><span class="ap-fieldlabel-hint">Markdown{starting ? ', optional' : ''}</span></span>
		<textarea id="{uid}-summary" class="ap-field ap-field-multi" aria-label={noun === 'room' ? 'Room description' : 'Thread summary'} rows={starting && !summary ? 4 : 8} bind:value={summary} disabled={saving} spellcheck="true"
			placeholder={noun === 'room' ? 'What this room is for.' : 'What this thread is about, or what it settled. Shows on its card and at the top of the thread.'}></textarea>
	</label>
	{#if note}<p class="ap-tedit-note">{note}</p>{/if}
	{#if error}<p class="ap-profedit-note ap-profedit-err" role="alert">{error}</p>{/if}
	{#snippet footer()}
		<Button variant="ghost" size="sm" onclick={() => (open = false)} disabled={saving} label="Cancel" />
		<Button type="submit" variant="primary" size="sm" disabled={saving || disabled} label={action} />
	{/snippet}
</Dialog>
