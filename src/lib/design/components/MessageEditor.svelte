<script lang="ts">
	/*
	 * Your message being edited, in place of its body: its text over its files (§4.8.4), as tiles as on a draft, and
	 * Save. It takes the focus as it opens, the caret at the end; Escape anywhere in it cancels (a name being typed
	 * keeps its own), and Enter in the text saves (Shift+Enter breaks the line). The field is a textarea, or your own
	 * (`field`), as in the Composer, with an autocomplete picker anchored above it.
	 */
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import Attachments from './Attachments.svelte';
	import Button from './Button.svelte';
	import { enterAction } from './compose';

	interface Props {
		/** The text; `bind:value`. */
		value?: string;
		/**
		 * Your own field in place of the textarea, such as a ComposerEditable that shows mentions as chips: it takes
		 * the focus, Enter and the text itself. Escape it handles first (`preventDefault`) doesn't cancel.
		 */
		field?: Snippet;
		/** An autocomplete picker (a <MentionPicker>) for your `field`, anchored above it. */
		picker?: Snippet;
		/** The message's files over the text, usually AttachmentTiles, each removable and maybe renamable. */
		attachments?: Snippet;
		/** False disables Save: a message keeps text or an embed (§3.5); emptied, it's deleted instead. */
		canSave?: boolean;
		/** A phone or tablet: Enter breaks the line as it does there (`enterAction`), and the keyboard hint is hidden. */
		handheld?: boolean;
		onsave?: () => void;
		oncancel?: () => void;
		/** Classes for the editor, added to its own. */
		class?: ClassValue;
		/** A `data-testid` for the editor. */
		testid?: string;
	}
	let { value = $bindable(''), field: ownField, picker, attachments, canSave = true, handheld = false, onsave, oncancel, class: className, testid }: Props = $props();

	let field = $state<HTMLTextAreaElement | undefined>();

	$effect(() => {
		if (!field) return;
		field.focus();
		field.setSelectionRange(field.value.length, field.value.length);
	});

	/** The field grows with its text: by CSS `field-sizing` where there is one, else by its scroll height. */
	const sizesItself = typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content');
	$effect(() => {
		void value;
		if (!field || sizesItself) return;
		field.style.height = 'auto';
		field.style.height = `${field.scrollHeight}px`;
	});

	function keydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return;
		event.preventDefault();
		oncancel?.();
	}

	function fieldKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter' || event.isComposing || enterAction(event, handheld) !== 'send') return;
		event.preventDefault();
		onsave?.();
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div data-testid={testid} class={['ap-msgedit', className]} onkeydown={keydown}>
	{#if attachments}<Attachments label="Attachments">{@render attachments()}</Attachments>{/if}
	{#if ownField}
		<div class="ap-msgedit-wrap">{@render picker?.()}{@render ownField()}</div>
	{:else}
		<textarea class="ap-msgedit-field" aria-label="Edit message" rows="1" dir="auto" bind:this={field} bind:value onkeydown={fieldKeydown}></textarea>
	{/if}
	<div class="ap-msgedit-foot">
		{#if !handheld}<span class="ap-msgedit-hint"><kbd>Esc</kbd> to cancel · <kbd>Enter</kbd> to save</span>{/if}
		<Button variant="ghost" size="sm" onclick={oncancel} label="Cancel" />
		<Button variant="primary" size="sm" disabled={!canSave} title={canSave ? undefined : 'A message needs text or an attachment; delete it instead'} onclick={onsave} label="Save changes" />
	</div>
</div>
