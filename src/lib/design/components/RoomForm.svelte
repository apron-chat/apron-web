<script lang="ts">
	import { tick, untrack, type Snippet } from 'svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import type { ClassValue } from 'svelte/elements';
	import Button from './Button.svelte';
	import Dialog from './Dialog.svelte';
	import MarkdownEditor from './MarkdownEditor.svelte';
	import type { RoomFormField } from './types';

	interface Props {
		/** Shown as a centered modal while true; bindable, and set false however it closes. */
		open?: boolean;
		/** A room (title and description), or a thread (title and description): a room with a `parent_room_id` (§3.4). */
		kind?: 'room' | 'thread';
		/**
		 * `create` a room or start a thread (`room_set` without a `room_id`, §4.2.4), or `edit` an existing one (`room_set` with it). A thread
		 * starts from its room, from a message (its text quoted as the description), or from selected messages.
		 */
		mode?: 'create' | 'edit';
		/** One line under the heading, such as the room a new thread goes in. */
		subtitle?: string;
		/**
		 * Private (§4.2.4), when creating. A room: the Private choice, `bind:private`. A thread takes its room's,
		 * so it's no choice: a note says so. Editing ignores it, since an omitted `private` is kept.
		 */
		private?: boolean;
		/** Starting a thread for this many selected messages, which move into it: said in the heading, a note and the button. */
		moving?: number;
		/** Title. `bind:name`. Focused when it opens; selected too when creating, so typing replaces a suggestion. */
		name?: string;
		/** The room's or thread's `description` (§3.4), Markdown. `bind:description`. */
		description?: string;
		/**
		 * Your own description field in place of a plain MarkdownEditor, such as one around a ComposerEditable, for
		 * formatting, a preview and mentions as chips. It is yours to fill and read (`description` then goes unused).
		 */
		field?: Snippet<[RoomFormField]>;
		/**
		 * Whether the description field shows; `bind:showDescription`. Starting a thread with no description, it waits
		 * behind "Add description" at the start of the footer, so it isn't taken for the thread's first message; a thread
		 * that starts with one (from a message), a room, and editing show it from the start.
		 */
		showDescription?: boolean;
		status?: 'idle' | 'saving';
		/** What went wrong: a missing title, or the server declining. */
		error?: string;
		/** The session can't take requests: the form stays open but won't submit. */
		disabled?: boolean;
		onsubmit?: () => void;
		/** It closed, whichever way: Cancel, Escape, the close button. */
		onclose?: () => void;
		/** Classes for its Dialog's `<dialog>`, added to its own. */
		class?: ClassValue;
	}
	let { open = $bindable(false), kind = 'thread', mode = 'edit', subtitle, private: isPrivate = $bindable(false), moving = 0, name = $bindable(''), description = $bindable(''), field, showDescription = $bindable(), status = 'idle', error, disabled = false, onsubmit, onclose, class: className }: Props = $props();
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
	let descriptionBox = $state<HTMLElement | undefined>();
	// Hidden only when starting a thread with nothing in it; once shown it stays.
	if (showDescription === undefined) showDescription = untrack(() => !(creating && thread && !description.trim()));
	async function addDescription(): Promise<void> {
		showDescription = true;
		await tick();
		descriptionBox?.querySelector<HTMLElement>('[contenteditable]:not([contenteditable="false"]), textarea')?.focus();
	}
	/** What the description's field is drawn with, yours or the MarkdownEditor's, kept as one object while its parts are the same. */
	const fieldArgs = $derived<RoomFormField>({
		label: thread ? 'Thread description' : 'Room description',
		placeholder: thread ? 'What this thread is about, or what it settled. Shows on its card and at the top of the thread.' : 'What this room is for.',
		disabled: saving,
		rows: creating ? 4 : 8,
		submit: () => { if (!saving && !disabled) onsubmit?.(); }
	});

	$effect(() => {
		if (!open) return;
		void tick().then(() => {
			nameInput?.focus();
			if (creating) nameInput?.select();
		});
	});
</script>

<!-- Escape, the close button and Cancel do nothing while it saves. -->
<Dialog class={['ap-roomform', className]} bind:open size="md" title={heading} {subtitle} locked={saving} {error} {onclose}
	onsubmit={(event) => { event.preventDefault(); if (!saving && !disabled) onsubmit?.(); }}>
	<label class="ap-fieldlabel" for="{uid}-name">Title
		<input id="{uid}-name" class="ap-field" aria-label="{thread ? 'Thread' : 'Room'} title" aria-required={creating} bind:this={nameInput} bind:value={name} disabled={saving} maxlength="120" autocomplete="off" spellcheck="true" dir="auto"
			placeholder={creating ? (thread ? 'What it’s about' : 'What to call it') : ''} />
	</label>
	<!-- The field is named by its `label`; this heads it. -->
	{#if showDescription}
	<div class="ap-fieldlabel" bind:this={descriptionBox}><span class="ap-fieldlabel-row"><span>Description</span><span class="ap-fieldlabel-hint">Markdown{creating ? ', optional' : ''}</span></span>
		{#if field}{@render field(fieldArgs)}{:else}<MarkdownEditor bind:value={description} label={fieldArgs.label} placeholder={fieldArgs.placeholder} disabled={saving} rows={fieldArgs.rows} />{/if}
	</div>
	{/if}
	{#if creating && !thread}
		<label class={['ap-choice-item', 'ap-checklist-item', isPrivate && 'ap-choice-on']}>
			<input class="ap-checklist-box" type="checkbox" bind:checked={isPrivate} disabled={saving} />
			<span class="ap-checklist-label"><span class="ap-choice-title">Private</span><span class="ap-choice-text">Only members see it, and members add others.</span></span>
		</label>
	{/if}
	{#if note}<p class="ap-roomform-note">{note}</p>{/if}
	{#snippet footer()}
		{#if !showDescription}<Button variant="ghost" size="sm" class="ap-roomform-addbtn" onclick={addDescription} disabled={saving}><Plus size={14} aria-hidden="true" />Add description</Button>{/if}
		<!-- Together, so a footer too narrow for all three puts these on a line of their own. -->
		<span class="ap-roomform-actions">
			<Button variant="ghost" size="sm" onclick={() => (open = false)} disabled={saving} label="Cancel" />
			<Button type="submit" variant="primary" size="sm" disabled={saving || disabled} label={action} />
		</span>
	{/snippet}
</Dialog>
