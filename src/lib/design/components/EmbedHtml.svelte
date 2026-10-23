<script lang="ts">
	/* html: the markup must ALREADY be sanitized (DOMPurify or equivalent). Other attributes go on its box. */
	import type { EmbedComponentProps } from './types';
	import { embedAttributes } from './util';
	let props: EmbedComponentProps = $props();
	const attributes = $derived(embedAttributes(props));
</script>

<div {...attributes} class={['ap-embed', 'ap-embed-html', attributes.class]}>{@html props.html || ''}</div>
