<script lang="ts">
	import { tick, untrack, type Snippet } from 'svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import TextAlignStart from '@lucide/svelte/icons/text-align-start';
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
		 * Starting a thread with no description yet: the field waits behind a control, so the description isn't taken for
		 * the thread's first message. `button` a ghost "Add description" under the title, `link` a quiet one beside the
		 * Title label, `icon` a description glyph at the end of the title field. `none` shows the field from the start.
		 * A thread that starts with a description (from a message) shows it whatever this is.
		 */
		descriptionReveal?: 'button' | 'link' | 'icon' | 'none';
		/** Whether the description field shows; `bind:showDescription`. Starts from `descriptionReveal`. */
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
	let { open = $bindable(false), kind = 'thread', mode = 'edit', subtitle, private: isPrivate = $bindable(false), moving = 0, name = $bindable(''), description = $bindable(''), field, descriptionReveal = 'icon', showDescription = $bindable(), status = 'idle', error, disabled = false, onsubmit, onclose, class: className }: Props = $props();
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
	if (showDescription === undefined) showDescription = untrack(() => !(creating && thread && descriptionReveal !== 'none' && !description.trim()));
	const reveal = $derived(showDescription ? undefined : descriptionReveal);
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
<Dialog class={className} bind:open size="md" title={heading} {subtitle} locked={saving} {error} {onclose}
	onsubmit={(event) => { event.preventDefault(); if (!saving && !disabled) onsubmit?.(); }}>
	<div class="ap-fieldlabel">
		<span class="ap-fieldlabel-row"><label for="{uid}-name">Title</label>
			{#if reveal === 'link'}<button type="button" class="ap-roomform-adddesc" onclick={addDescription} disabled={saving}>Add description</button>{/if}
		</span>
		<span class={['ap-roomform-name', reveal === 'icon' && 'ap-roomform-name-icon']}>
			<input id="{uid}-name" class="ap-field" aria-label="{thread ? 'Thread' : 'Room'} title" aria-required={creating} bind:this={nameInput} bind:value={name} disabled={saving} maxlength="120" autocomplete="off" spellcheck="true" dir="auto"
				placeholder={creating ? (thread ? 'What it’s about' : 'What to call it') : ''} />
			{#if reveal === 'icon'}<button type="button" class="ap-iconbtn ap-roomform-descicon" aria-label="Add description" title="Add description" onclick={addDescription} disabled={saving}><TextAlignStart size={16} aria-hidden="true" /></button>{/if}
		</span>
		{#if reveal === 'button'}<Button variant="ghost" size="sm" class="ap-roomform-addbtn" onclick={addDescription} disabled={saving}><Plus size={14} aria-hidden="true" />Add description</Button>{/if}
	</div>
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
		<Button variant="ghost" size="sm" onclick={() => (open = false)} disabled={saving} label="Cancel" />
		<Button type="submit" variant="primary" size="sm" disabled={saving || disabled} label={action} />
	{/snippet}
</Dialog>
