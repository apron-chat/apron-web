<script lang="ts">
	/* terminal (§4.8.6): live while url is set and not done (the consumer writes GET url to its screen), finished once
	   the embed carries output. The screen is the consumer's, through `attach` (such as an xterm.js terminal); without
	   one, `text` shows as plain preformatted text. Its `class` and `testid` go on its box. */
	import type { EmbedComponentProps } from './types';

	let props: EmbedComponentProps = $props();
	const live = $derived(!!props.url && !props.done);
</script>

<div data-testid={props.testid} class={['ap-embed', 'ap-embed-terminal', live && 'ap-embed-terminal-live', props.class]}>
	<div class="ap-embed-termhead">
		<span class="ap-embed-termtitle" dir="auto">{props.title || 'Terminal'}</span>
		{#if live}<span class="ap-embed-livebadge" role="status"><i aria-hidden="true"></i>Live</span>
		{:else}<span class="ap-embed-detail">{props.status || 'Finished'}</span>{/if}
	</div>
	{#if props.attach}<div class="ap-embed-termscreen" dir="ltr" {@attach props.attach}></div>
	{:else}<pre class="ap-embed-termscreen ap-embed-termtext" dir="ltr">{props.text || ''}</pre>{/if}
</div>
