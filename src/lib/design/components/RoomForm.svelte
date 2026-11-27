<script lang="ts">
	import { tick, untrack, type Snippet } from 'svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import type { ClassValue } from 'svelte/elements';
	import Button from './Button.svelte';
	import Dialog from './Dialog.svelte';
	import MarkdownEditor from './MarkdownEditor.svelte';
	import { descriptionField, firstMessageField, type RoomFormField } from './types';

	interface Props {
		/** Shown as a centered modal while true; bindable, and set false however it closes. */
		open?: boolean;
		/**
		 * Create a room, or start a thread (a room with a `parent_room_id`, §3.4): `room_set` without a `room_id` (§4.2.4). A
		 * thread starts from its room, from a message (its text quoted as the description), or from selected messages. An
		 * existing one is edited where its description reads (DescriptionSheet).
		 */
		kind?: 'room' | 'thread';
		/** One line under the heading, such as the room a new thread goes in. */
		subtitle?: string;
		/**
		 * Private (§4.2.4). A room: the Private choice, `bind:private`. A thread takes its room's, so it's no choice: a note
		 * says so.
		 */
		private?: boolean;
		/** Starting a thread for this many selected messages, which move into it: said in the heading, a note and the button. */
		moving?: number;
		/** Title. `bind:name`. Focused and selected when it opens, so typing replaces a suggestion. */
		name?: string;
		/** The room's or thread's `description` (§3.4), Markdown. `bind:description`. */
		description?: string;
		/**
		 * Your own description field in place of a plain MarkdownEditor, such as one around a ComposerEditable, for
		 * formatting, a preview and mentions as chips. It is yours to fill and read (`description` then goes unused).
		 */
		field?: Snippet<[RoomFormField]>;
		/**
		 * A new thread's first message: its field, yours to fill and read like `field`. Offered behind "Add first message"
		 * (or "Add reply", with `replyTo`), ahead of "Add description", when starting a thread that moves no messages;
		 * sent in it once it exists.
		 */
		firstMessage?: Snippet<[RoomFormField]>;
		/** Starting a thread on a message: the name of who wrote it, whom the first message replies to (across rooms, §3.5.4). */
		replyTo?: string;
		/** Whether the first message's field shows; `bind:showFirstMessage`. Hidden until it's added, and again once removed. */
		showFirstMessage?: boolean;
		/**
		 * Whether the description field shows; `bind:showDescription`. Starting a thread with no description, it waits
		 * behind "Add description" at the start of the footer, so it isn't taken for the thread's first message, and its ×
		 * puts it back there; a thread that starts with one, and a room, show it from the start.
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
	let { open = $bindable(false), kind = 'thread', subtitle, private: isPrivate = $bindable(false), moving = 0, name = $bindable(''), description = $bindable(''), field, firstMessage, replyTo, showFirstMessage = $bindable(false), showDescription = $bindable(), status = 'idle', error, disabled = false, onsubmit, onclose, class: className }: Props = $props();
	const uid = $props.id();
	const saving = $derived(status === 'saving');
	const thread = $derived(kind === 'thread');
	const moves = $derived(thread ? moving : 0);
	const heading = $derived(!thread ? 'Create a room' : moves ? 'Move to a new thread' : 'Start thread');
	const action = $derived(!thread ? (saving ? 'Creating…' : 'Create room')
		: moves ? (saving ? 'Moving…' : `Move ${moves === 1 ? 'message' : `${moves} messages`}`)
		: (saving ? 'Starting…' : 'Start thread'));
	/** What starting a thread will do, in a line under the fields. */
	const note = $derived(thread ? [
		moves ? `${moves === 1 ? 'The selected message moves' : `The ${moves} selected messages move`} into the new thread.` : '',
		isPrivate ? 'Private, like its room: only the room’s members see it.' : ''
	].filter(Boolean).join(' ') : '');
	let nameInput = $state<HTMLInputElement | undefined>();
	let descriptionBox = $state<HTMLElement | undefined>();
	let firstMessageBox = $state<HTMLElement | undefined>();
	/** A first message is offered when starting a thread that moves none: one that does starts with those. */
	const offersFirstMessage = $derived(thread && !moves && firstMessage !== undefined);
	// Hidden only when starting a thread with nothing in it; once shown it stays.
	if (showDescription === undefined) showDescription = untrack(() => !(thread && !description.trim()));
	/** Shows a field put away, and puts the cursor in it. */
	async function reveal(box: () => HTMLElement | undefined): Promise<void> {
		await tick();
		box()?.querySelector<HTMLElement>('[contenteditable]:not([contenteditable="false"]), textarea')?.focus();
	}
	function addFirstMessage(): void {
		showFirstMessage = true;
		void reveal(() => firstMessageBox);
	}
	function addDescription(): void {
		showDescription = true;
		void reveal(() => descriptionBox);
	}
	/** A thread's field put away again by its ×, back behind its Add button, which takes the keyboard. */
	async function remove(which: 'first' | 'description'): Promise<void> {
		const form = nameInput?.form;
		if (which === 'first') showFirstMessage = false;
		else showDescription = false;
		await tick();
		form?.querySelector<HTMLElement>(`[data-add="${which}"]`)?.focus();
	}
	/** What the description's field is drawn with, yours or the MarkdownEditor's, kept as one object while its parts are the same. */
	const fieldArgs = $derived<RoomFormField>(descriptionField(thread, {
		disabled: saving,
		rows: 4,
		submit: () => { if (!saving && !disabled) onsubmit?.(); }
	}));
	const firstMessageArgs = $derived(firstMessageField(replyTo, {
		disabled: saving,
		rows: 4,
		submit: () => { if (!saving && !disabled) onsubmit?.(); }
	}));

	$effect(() => {
		if (!open) return;
		void tick().then(() => {
			nameInput?.focus();
			nameInput?.select();
		});
	});
</script>

<!-- Escape, the close button and Cancel do nothing while it saves. -->
<Dialog class={['ap-roomform', className]} bind:open size="md" title={heading} {subtitle} locked={saving} {error} {onclose}
	onsubmit={(event) => { event.preventDefault(); if (!saving && !disabled) onsubmit?.(); }}>
	<label class="ap-fieldlabel" for="{uid}-name">Title
		<input id="{uid}-name" class="ap-field" aria-label="{thread ? 'Thread' : 'Room'} title" aria-required="true" bind:this={nameInput} bind:value={name} disabled={saving} maxlength="120" autocomplete="off" spellcheck="true" dir="auto"
			placeholder={thread ? 'What it’s about' : 'What to call it'} />
	</label>
	<!-- Each field is named by its `label`; these head them. -->
	{#if offersFirstMessage && showFirstMessage}
	<div class="ap-fieldlabel" bind:this={firstMessageBox}><span class="ap-fieldlabel-row"><span>{firstMessageArgs.heading}</span>{@render removeButton('first', firstMessageArgs.label)}</span>
		{@render firstMessage?.(firstMessageArgs)}
	</div>
	{/if}
	{#if showDescription}
	<div class="ap-fieldlabel" bind:this={descriptionBox}><span class="ap-fieldlabel-row"><span>Description</span>{#if thread}{@render removeButton('description', 'description')}{/if}</span>
		{#if field}{@render field(fieldArgs)}{:else}<MarkdownEditor bind:value={description} label={fieldArgs.label} placeholder={fieldArgs.placeholder} disabled={saving} rows={fieldArgs.rows} />{/if}
	</div>
	{/if}
	{#if !thread}
		<label class={['ap-choice-item', 'ap-checklist-item', isPrivate && 'ap-choice-on']}>
			<input class="ap-checklist-box" type="checkbox" bind:checked={isPrivate} disabled={saving} />
			<span class="ap-checklist-label"><span class="ap-choice-title">Private</span><span class="ap-choice-text">Only members see it, and members add others.</span></span>
		</label>
	{/if}
	{#if note}<p class="ap-roomform-note">{note}</p>{/if}
	{#snippet footer()}
		{#if (offersFirstMessage && !showFirstMessage) || !showDescription}
			<!-- Together at the start of the footer, so a narrow one puts Cancel and the action on a line of their own. -->
			<span class="ap-roomform-adds">
				{#if offersFirstMessage && !showFirstMessage}<Button variant="ghost" size="sm" class="ap-roomform-addbtn" data-add="first" onclick={addFirstMessage} disabled={saving}><Plus size={14} aria-hidden="true" />{replyTo !== undefined ? 'Add reply' : 'Add first message'}</Button>{/if}
				{#if !showDescription}<Button variant="ghost" size="sm" class="ap-roomform-addbtn" data-add="description" onclick={addDescription} disabled={saving}><Plus size={14} aria-hidden="true" />Add description</Button>{/if}
			</span>
		{/if}
		<!-- Together, so a footer too narrow for them all puts these on a line of their own. -->
		<span class="ap-roomform-actions">
			<Button variant="ghost" size="sm" onclick={() => (open = false)} disabled={saving} label="Cancel" />
			<Button type="submit" variant="primary" size="sm" disabled={saving || disabled} label={action} />
		</span>
	{/snippet}
</Dialog>

{#snippet removeButton(which: 'first' | 'description', name: string)}
	<button type="button" class="ap-iconbtn ap-roomform-remove" aria-label="Remove {name.toLowerCase()}" title="Remove {name.toLowerCase()}" disabled={status === 'saving'} onclick={() => void remove(which)}><X size={14} aria-hidden="true" /></button>
{/snippet}
