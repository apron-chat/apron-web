<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import ComposerEditable from '$lib/design/components/ComposerEditable.svelte';
	import type { DraftField } from '$lib/ui/draft-field.svelte';

	/**
	 * A message field (the design system's `ComposerEditable`) wired to its
	 * `DraftField`: mentions as chips, and the keys and caret its autocomplete
	 * follows. The composer's and the message editor's alike.
	 */
	interface Props extends Omit<ComponentProps<typeof ComposerEditable>, 'element' | 'empty'> {
		draft: DraftField;
	}
	let { draft, ...rest }: Props = $props();
</script>

<!-- spread: the field's own attributes (an `id`, a `data-testid`, its label, `onpaste`), which the caller decides -->
<ComposerEditable
	{...rest}
	{...draft.aria}
	empty={draft.empty}
	bind:element={draft.element}
	onbeforeinput={draft.beforeinput}
	oninput={draft.input}
	oncompositionend={draft.compositionend}
	onkeydown={draft.keydown}
	onkeyup={draft.refreshQuery}
	onclick={draft.refreshQuery}
	onblur={draft.blur}
/>
