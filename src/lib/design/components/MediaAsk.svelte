<script lang="ts">
	/* Media that waits for a click (Preferences' Media): what and where it is, then Load for this once, and Always load
	   from its site where it can be trusted. Message bodies get the same markup from the sanitizer
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
	let { host, what = 'Image', onload, ontrust, class: className, testid }: Props = $props();
</script>

<span class={['ap-media-ask', className]} data-testid={testid}>
	<span class="ap-media-ask-label"><span class="ap-media-ask-what">{what}</span> <span class="ap-media-ask-host">{host}</span></span>
	<span class="ap-media-ask-actions">
		<Button size="sm" label="Load" aria-label="Load {what} from {host}" onclick={onload} />
		{#if ontrust}<Button size="sm" label="Always load from {host}" title="Adds {host} to Trusted origins" onclick={ontrust} />{/if}
	</span>
</span>
