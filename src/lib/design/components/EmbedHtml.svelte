<script lang="ts">
	/* html: the markup must ALREADY be sanitized (DOMPurify or equivalent). */
	import type { EmbedProps } from './types';
	let props: EmbedProps = $props();
</script>

<div class="ap-embed ap-embed-html">{@html props.html || ''}</div>
