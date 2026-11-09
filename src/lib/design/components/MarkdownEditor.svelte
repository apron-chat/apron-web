<script lang="ts">
	/*
	 * A Markdown field in a form, such as a room's or thread's description: the field in a bordered box, with formatting
	 * buttons (`toolbar`) and Write and Preview (`rendered`) along its top when given, as on the Composer's full panel.
	 * The field is a textarea, or your own (`field`), such as a ComposerEditable that shows mentions as chips; an
	 * autocomplete picker it draws anchors to it. Preview hides the field rather than removing it, so its text and caret
	 * stay as they were.
	 */
	import { tick, type Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import WritePreview from './WritePreview.svelte';
	import type { MarkdownEditorField } from './types';

	interface Props {
		/** The textarea's text; `bind:value`. Unused with your own `field`, which you fill and read, as `rendered` is yours. */
		value?: string;
		/** The field's accessible name, such as "Room description". */
		label: string;
		placeholder?: string;
		disabled?: boolean;
		/** How many lines tall the field is at least; it grows with its text up to half the window. */
		rows?: number;
		/** Your own field in place of the textarea, given the class, name, placeholder and whether it is disabled. */
		field?: Snippet<[MarkdownEditorField]>;
		/** Formatting buttons, along its top while writing. */
		toolbar?: Snippet;
		/** The text as it will show, which Preview shows in place of the field. Omit for no Write and Preview. */
		rendered?: Snippet;
		/** Preview is chosen; `bind:previewing`. */
		previewing?: boolean;
		/** Write or Preview was chosen, after it shows: back to Write, a moment to put the keyboard back in your field. */
		onpreview?: (previewing: boolean) => void;
		/** Classes for the box, added to its own. */
		class?: ClassValue;
		/** A `data-testid` for the box. */
		testid?: string;
	}
	let { value = $bindable(''), label, placeholder, disabled = false, rows = 4, field, toolbar, rendered, previewing = $bindable(false), onpreview, class: className, testid }: Props = $props();

	const showing = $derived(previewing && Boolean(rendered));
	/** What `field` is drawn with, kept as one object while its parts are the same, as the field reads it on every key. */
	const fieldArgs = $derived({ class: 'ap-mdedit-field', label, placeholder: placeholder ?? '', disabled });
	let textarea = $state<HTMLTextAreaElement | undefined>();

	/** Write or Preview; back to Write, the keyboard goes back in the field, the textarea's here or yours by `onpreview`. */
	async function choose(on: boolean): Promise<void> {
		previewing = on;
		await tick();
		if (!on) textarea?.focus();
		onpreview?.(on);
	}
</script>

<div class={['ap-mdedit', showing && 'ap-mdedit-previewing', disabled && 'ap-mdedit-disabled', className]} style:--ap-mdedit-rows={rows} data-testid={testid}>
	{#if toolbar || rendered}
		<div class="ap-mdhead">
			{#if !showing}{@render toolbar?.()}{/if}
			<span class="ap-mdhead-grow"></span>
			{#if rendered}<WritePreview {previewing} onpreview={(on) => void choose(on)} />{/if}
		</div>
	{/if}
	<div class="ap-mdedit-wrap">
		{#if field}{@render field(fieldArgs)}
		{:else}
			<textarea class="ap-mdedit-field" aria-label={label} {placeholder} {disabled} spellcheck="true" dir="auto" bind:value bind:this={textarea}></textarea>
		{/if}
	</div>
	{#if showing}<div class="ap-mdedit-rendered">{@render rendered?.()}</div>{/if}
</div>
