<script lang="ts">
	/*
	 * Your message being edited, in place of its body: its text over its files (§4.8.4), as tiles as on a draft, and
	 * Save. It takes the focus as it opens, the caret at the end; Escape anywhere in it cancels (a name being typed
	 * keeps its own), and Enter in the text saves (Shift+Enter breaks the line).
	 */
	import type { Snippet } from 'svelte';
	import Attachments from './Attachments.svelte';
	import Button from './Button.svelte';

	interface Props {
		/** The text; `bind:value`. */
		value?: string;
		/** The message's files over the text, usually AttachmentTiles, each removable and maybe renamable. */
		attachments?: Snippet;
		/** False disables Save: a message keeps text or an embed (§3.5); emptied, it's deleted instead. */
		canSave?: boolean;
		/** A phone or tablet: Enter breaks the line as it does there, and the keyboard hint is hidden. */
		handheld?: boolean;
		onsave?: () => void;
		oncancel?: () => void;
	}
	let { value = $bindable(''), attachments, canSave = true, handheld = false, onsave, oncancel }: Props = $props();

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
		if (event.key !== 'Escape' || event.isComposing) return;
		event.preventDefault();
		oncancel?.();
	}

	function fieldKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter' || event.isComposing || event.shiftKey || handheld) return;
		event.preventDefault();
		onsave?.();
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="ap-msgedit" data-testid="message-editor" onkeydown={keydown}>
	{#if attachments}<Attachments aria-label="Attachments">{@render attachments()}</Attachments>{/if}
	<textarea class="ap-msgedit-field" aria-label="Edit message" rows="1" dir="auto" bind:this={field} bind:value onkeydown={fieldKeydown}></textarea>
	<div class="ap-msgedit-foot">
		{#if !handheld}<span class="ap-msgedit-hint"><kbd>Esc</kbd> to cancel · <kbd>Enter</kbd> to save</span>{/if}
		<Button variant="ghost" size="sm" onclick={oncancel} label="Cancel" />
		<Button variant="primary" size="sm" disabled={!canSave} title={canSave ? undefined : 'A message needs text or an attachment; delete it instead'} onclick={onsave} label="Save changes" />
	</div>
</div>
