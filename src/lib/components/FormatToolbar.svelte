<script lang="ts">
	import Bold from '@lucide/svelte/icons/bold';
	import Code from '@lucide/svelte/icons/code';
	import Italic from '@lucide/svelte/icons/italic';
	import Link from '@lucide/svelte/icons/link';
	import List from '@lucide/svelte/icons/list';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import ListOrdered from '@lucide/svelte/icons/list-ordered';
	import SquareCode from '@lucide/svelte/icons/square-code';
	import Strikethrough from '@lucide/svelte/icons/strikethrough';
	import TextQuote from '@lucide/svelte/icons/text-quote';
	import { codeBlock, link, prefixLines, wrap, type TextEdit } from '$lib/ui/markdown-format';
	import { rovingToolbar } from '$lib/ui/toolbar-focus';

	/**
	 * The full panel's formatting buttons, along its top: each writes the Markdown for its format around the selection
	 * or on the lines it touches, or takes it off again (`markdown-format.ts`). Loaded on demand with the panel.
	 * One Tab stop, the arrows moving between its buttons (`rovingToolbar`), in groups a screen reader names.
	 */
	interface Props {
		/** Makes a change in the field (`MessageField.apply`). */
		apply: (change: (edit: TextEdit) => TextEdit | undefined) => boolean;
		disabled?: boolean;
	}
	let { apply, disabled = false }: Props = $props();

	/** Where the browser has focusgroup, it moves the focus itself (`rovingToolbar` then does nothing). */
	const focusgroup = { focusgroup: 'toolbar wrap' };

	const groups = [
		['Text', [
			{ label: 'Bold', icon: Bold, change: (edit: TextEdit) => wrap(edit, '**') },
			{ label: 'Italic', icon: Italic, change: (edit: TextEdit) => wrap(edit, '*') },
			{ label: 'Strikethrough', icon: Strikethrough, change: (edit: TextEdit) => wrap(edit, '~~') },
			{ label: 'Link', icon: Link, change: link }
		]],
		['Lists', [
			{ label: 'Bulleted list', icon: List, change: (edit: TextEdit) => prefixLines(edit, 'bullet') },
			{ label: 'Numbered list', icon: ListOrdered, change: (edit: TextEdit) => prefixLines(edit, 'number') },
			{ label: 'Checklist', icon: ListChecks, change: (edit: TextEdit) => prefixLines(edit, 'task') },
			{ label: 'Quote', icon: TextQuote, change: (edit: TextEdit) => prefixLines(edit, 'quote') }
		]],
		['Code', [
			{ label: 'Inline code', icon: Code, change: (edit: TextEdit) => wrap(edit, '`') },
			{ label: 'Code block', icon: SquareCode, change: codeBlock }
		]]
	] as const;
</script>

<!-- spread: `focusgroup`, which Svelte's types don't know yet -->
<div class="ap-composer-format" role="toolbar" aria-label="Formatting" {...focusgroup} {@attach rovingToolbar}>
	{#each groups as [name, tools], index (name)}
		{#if index > 0}<span class="ap-composer-format-sep" role="separator" aria-orientation="vertical"></span>{/if}
		<div class="ap-composer-format-group" role="group" aria-label={name}>
			{#each tools as tool (tool.label)}
				<!-- Pressing one leaves the focus, and the selection, in the field. -->
				<button type="button" class="ap-iconbtn" aria-label={tool.label} title={tool.label} {disabled} onmousedown={(event) => event.preventDefault()} onclick={() => apply(tool.change)}>
					<tool.icon size={18} aria-hidden="true" />
				</button>
			{/each}
		</div>
	{/each}
</div>
