<script lang="ts">
	/*
	 * Write and Preview, for a Markdown field: a pair of radios that switch between the field and the text as it will
	 * show. The Composer's full panel and a MarkdownEditor both use it.
	 */
	import type { ClassValue } from 'svelte/elements';

	interface Props {
		/** Preview is chosen: the text as it will show, in place of the field. */
		previewing?: boolean;
		onpreview?: (previewing: boolean) => void;
		/** Classes for the switch, added to its own. */
		class?: ClassValue;
	}
	let { previewing = false, onpreview, class: className }: Props = $props();
</script>

<div class={['ap-seg', 'ap-views', className]} role="radiogroup" aria-label="View">
	<button type="button" role="radio" aria-checked={!previewing} class={['ap-seg-item', !previewing && 'ap-seg-on']} onclick={() => onpreview?.(false)}>Write</button>
	<button type="button" role="radio" aria-checked={previewing} class={['ap-seg-item', previewing && 'ap-seg-on']} onclick={() => onpreview?.(true)}>Preview</button>
</div>
