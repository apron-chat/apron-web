<script lang="ts">
	import Bold from '@lucide/svelte/icons/bold';
	import Code from '@lucide/svelte/icons/code';
	import Italic from '@lucide/svelte/icons/italic';
	import Link from '@lucide/svelte/icons/link';
	import List from '@lucide/svelte/icons/list';
	import ListOrdered from '@lucide/svelte/icons/list-ordered';
	import SquareCode from '@lucide/svelte/icons/square-code';
	import Strikethrough from '@lucide/svelte/icons/strikethrough';
	import TextQuote from '@lucide/svelte/icons/text-quote';
	import { codeBlock, link, prefixLines, wrap, type TextEdit } from '$lib/ui/markdown-format';

	/**
	 * The full panel's formatting buttons, along its top: each writes the Markdown for its format around the selection
	 * or on the lines it touches, or takes it off again (`markdown-format.ts`). Loaded on demand with the panel.
	 */
	interface Props {
		/** Makes a change in the field (`MessageField.apply`). */
		apply: (change: (edit: TextEdit) => TextEdit | undefined) => boolean;
		disabled?: boolean;
	}
	let { apply, disabled = false }: Props = $props();

	const groups = [
		[
			{ label: 'Bold', icon: Bold, change: (edit: TextEdit) => wrap(edit, '**') },
			{ label: 'Italic', icon: Italic, change: (edit: TextEdit) => wrap(edit, '_') },
			{ label: 'Strikethrough', icon: Strikethrough, change: (edit: TextEdit) => wrap(edit, '~~') },
			{ label: 'Link', icon: Link, change: link }
		],
		[
			{ label: 'Bulleted list', icon: List, change: (edit: TextEdit) => prefixLines(edit, 'bullet') },
			{ label: 'Numbered list', icon: ListOrdered, change: (edit: TextEdit) => prefixLines(edit, 'number') },
			{ label: 'Quote', icon: TextQuote, change: (edit: TextEdit) => prefixLines(edit, 'quote') }
		],
		[
			{ label: 'Inline code', icon: Code, change: (edit: TextEdit) => wrap(edit, '`') },
			{ label: 'Code block', icon: SquareCode, change: codeBlock }
		]
	];
</script>

<div class="ap-composer-format" role="toolbar" aria-label="Formatting">
	{#each groups as tools, index (index)}
		{#if index > 0}<span class="ap-composer-format-sep" aria-hidden="true"></span>{/if}
		{#each tools as tool (tool.label)}
			<!-- Pressing one leaves the focus, and the selection, in the field. -->
			<button type="button" class="ap-iconbtn" aria-label={tool.label} title={tool.label} {disabled} onmousedown={(event) => event.preventDefault()} onclick={() => apply(tool.change)}>
				<tool.icon size={18} aria-hidden="true" />
			</button>
		{/each}
	{/each}
</div>
