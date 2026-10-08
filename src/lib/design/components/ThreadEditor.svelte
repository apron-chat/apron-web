<script lang="ts">
	import { tick } from 'svelte';
	import Button from './Button.svelte';
	import Dialog from './Dialog.svelte';

	interface Props {
		/** Shown as a centered modal while true; bindable, and set false however it closes. */
		open?: boolean;
		/** `edit` an existing thread or room (`room_set`, §4.3.4), or `start` a thread from a message (`room_create`). */
		mode?: 'edit' | 'start';
		/** A room's title and description rather than a thread's title and summary (`edit` only). */
		room?: boolean;
		/** One line under the heading, such as the room a new thread goes in. */
		subtitle?: string;
		/** Title. `bind:name`. Focused when it opens; selected too when starting, so typing replaces the suggestion. */
		name?: string;
		/** Summary: the thread's `description`, Markdown. Starting from a message, its text as a `>` quote. `bind:summary`. */
		summary?: string;
		status?: 'idle' | 'saving';
		/** What went wrong, such as the server declining the change. */
		error?: string;
		/** The session can't take requests: the form stays open but won't submit. */
		disabled?: boolean;
		onsubmit?: () => void;
		/** It closed, whichever way: Cancel, Escape, the close button. */
		onclose?: () => void;
	}
	let { open = $bindable(false), mode = 'edit', room = false, subtitle, name = $bindable(''), summary = $bindable(''), status = 'idle', error, disabled = false, onsubmit, onclose }: Props = $props();
	const uid = $props.id();
	const saving = $derived(status === 'saving');
	const starting = $derived(mode === 'start');
	const noun = $derived(room && !starting ? 'room' : 'thread');
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
<Dialog bind:open size="md" title={starting ? 'Start thread' : `Edit ${noun}`} {subtitle} locked={saving} testid="thread-editor" {onclose}
	onsubmit={(event) => { event.preventDefault(); if (!saving && !disabled) onsubmit?.(); }}>
	<label class="ap-fieldlabel" for="{uid}-name">Title
		<input id="{uid}-name" class="ap-field" aria-label="{noun === 'room' ? 'Room' : 'Thread'} title" bind:this={nameInput} bind:value={name} disabled={saving} maxlength="120" autocomplete="off" spellcheck="true" />
	</label>
	<label class="ap-fieldlabel" for="{uid}-summary"><span class="ap-fieldlabel-row"><span>{noun === 'room' ? 'Description' : 'Summary'}</span><span class="ap-fieldlabel-hint">Markdown</span></span>
		<textarea id="{uid}-summary" class="ap-field ap-field-multi" aria-label={noun === 'room' ? 'Room description' : 'Thread summary'} rows="8" bind:value={summary} disabled={saving} spellcheck="true"
			placeholder={noun === 'room' ? 'What this room is for.' : 'What this thread is about, or what it settled. Shows on its card and at the top of the thread.'}></textarea>
	</label>
	{#if error}<p class="ap-profedit-note ap-profedit-err" role="alert">{error}</p>{/if}
	{#snippet footer()}
		<Button variant="ghost" size="sm" onclick={() => (open = false)} disabled={saving} label="Cancel" />
		<Button type="submit" variant="primary" size="sm" disabled={saving || disabled}
			label={starting ? (saving ? 'Starting…' : 'Start thread') : (saving ? 'Saving…' : 'Save')} />
	{/snippet}
</Dialog>
