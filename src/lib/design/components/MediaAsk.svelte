<script lang="ts">
	/* Media that waits for a click (Preferences' Media): what it is and its full URL, then Load for this once, and Always load
	   from its site and Block its site where it can be trusted or blocked. A long host is cut short at its start in its button,
	   on one line, so the end that names the site still shows: the URL above shows it in full. Message bodies get the same markup from the sanitizer
	   ($lib/protocol/sanitize), so the two look alike. Its `class` and `testid` go on its root. */
	import type { ClassValue } from 'svelte/elements';
	import Button from './Button.svelte';
	import type { MediaAskProps } from './types';

	interface Props extends MediaAskProps {
		/** What it is: an image's alt text, else its kind. */
		what?: string;
		class?: ClassValue;
		testid?: string;
	}
	let { url, host, what = 'Image', onload, ontrust, onblock, class: className, testid }: Props = $props();
</script>

<span class={['ap-media-ask', className]} data-testid={testid}>
	<span class="ap-media-ask-label"><span class="ap-media-ask-what">{what}</span> <span class="ap-media-ask-url">{url}</span></span>
	<span class="ap-media-ask-actions">
		<Button size="sm" label="Load" aria-label="Load {what} from {host}" onclick={onload} />
		{#if ontrust}<Button size="sm" aria-label="Always load from {host}" title="Adds {host} to Trusted origins" onclick={ontrust}><span class="ap-media-ask-btntext">Always load from</span> <span class="ap-media-ask-host">{host}</span></Button>{/if}
		{#if onblock}<Button size="sm" aria-label="Block {host}" title="Adds {host} to Blocked origins" onclick={onblock}><span class="ap-media-ask-btntext">Block</span> <span class="ap-media-ask-host">{host}</span></Button>{/if}
	</span>
</span>
