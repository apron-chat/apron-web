<script lang="ts">
	/* stream (§4.8.5): live while url is set (the consumer streams GET url into text), finished when text replaces url. Other attributes go on its box. */
	import type { EmbedComponentProps } from './types';
	import { embedAttributes } from './util';

	let props: EmbedComponentProps = $props();
	const attributes = $derived(embedAttributes(props));
	const live = $derived(!!props.url && !props.done);
	const fmt = $derived(props.format === 'terminal' ? 'terminal' : props.format === 'markdown' ? 'markdown' : 'plain');
</script>

{#snippet body()}{#if props.children}{@render props.children()}{:else}{props.text || ''}{/if}{#if live}<span class="ap-embed-caret" aria-hidden="true"></span>{/if}{/snippet}

<div {...attributes} class={['ap-embed', 'ap-embed-stream', 'ap-embed-stream-' + fmt, live && 'ap-embed-stream-live', attributes.class]}>
	<div class="ap-embed-streamhead">
		<span class="ap-embed-streamkind">{props.title || (fmt === 'terminal' ? 'Terminal' : fmt === 'markdown' ? 'Live text' : 'Output')}</span>
		{#if live}<span class="ap-embed-livebadge" role="status"><i aria-hidden="true"></i>Live</span>
		{:else}<span class="ap-embed-detail">{props.status || (props.truncated ? 'Finished · earlier output trimmed' : 'Finished')}</span>{/if}
	</div>
	{#if fmt === 'markdown'}
		<div class="ap-embed-streambody ap-msg-text" {@attach props.attach}>{@render body()}</div>
	{:else}
		<pre class="ap-embed-streambody" aria-live={live ? 'polite' : undefined}>{@render body()}</pre>
	{/if}
</div>
