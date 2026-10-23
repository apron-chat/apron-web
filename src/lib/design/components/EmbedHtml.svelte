<script lang="ts">
	/* html: the markup must ALREADY be sanitized (DOMPurify or equivalent). Its `class` and `testid` go on its box. */
	import type { EmbedComponentProps } from './types';
	let props: EmbedComponentProps = $props();
</script>

<div data-testid={props.testid} class={['ap-embed', 'ap-embed-html', props.class]}>{@html props.html || ''}</div>
