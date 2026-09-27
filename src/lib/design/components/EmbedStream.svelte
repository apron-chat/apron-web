<script lang="ts">
	/* stream (§4.6.5): live while url is set (the consumer streams GET url into text), finished when text replaces url */
	import type { EmbedProps } from './types';
	import { cx } from './util';

	let props: EmbedProps = $props();
	const live = $derived(!!props.url && !props.done);
	const fmt = $derived(props.format === 'terminal' ? 'terminal' : props.format === 'markdown' ? 'markdown' : 'plain');
</script>

<div class={cx('ap-embed', 'ap-embed-stream', 'ap-embed-stream-' + fmt, live && 'ap-embed-stream-live')}>
	<div class="ap-embed-streamhead">
		<span class="ap-embed-streamkind">{fmt === 'terminal' ? 'Terminal' : fmt === 'markdown' ? 'Live text' : 'Output'}</span>
		{#if live}<span class="ap-embed-livebadge" role="status"><i aria-hidden="true"></i>Live</span>
		{:else}<span class="ap-embed-detail">{props.truncated ? 'Finished · earlier output trimmed' : 'Finished'}</span>{/if}
	</div>
	{#if fmt === 'markdown'}
		<div class="ap-embed-streambody ap-msg-text">{#if props.children}{@render props.children()}{:else}{props.text || ''}{/if}{#if live}<span class="ap-embed-caret" aria-hidden="true"></span>{/if}</div>
	{:else}
		<pre class="ap-embed-streambody" aria-live={live ? 'polite' : undefined}>{#if props.children}{@render props.children()}{:else}{props.text || ''}{/if}{#if live}<span class="ap-embed-caret" aria-hidden="true"></span>{/if}</pre>
	{/if}
</div>
