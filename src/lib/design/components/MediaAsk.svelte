<script lang="ts">
	/* Media that waits for a click (Preferences' Media): what and where it is, Load for this once, and Always load from
	   its site where it can be trusted. Message bodies get the same markup from the sanitizer ($lib/protocol/sanitize),
	   so the two look alike. Its `class` and `testid` go on its root. */
	import type { ClassValue } from 'svelte/elements';
	import type { MediaAskProps } from './types';

	interface Props extends MediaAskProps {
		/** What it is: an image's alt text, else its kind. */
		what?: string;
		class?: ClassValue;
		testid?: string;
	}
	let { host, what = 'Image', onload, ontrust, class: className, testid }: Props = $props();
</script>

<span class={['ap-media-ask', className]} data-testid={testid}><span class="ap-media-ask-what">{what}</span> <span class="ap-media-ask-host">{host}</span> <button type="button" class="ap-media-ask-btn" aria-label="Load {what} from {host}" onclick={onload}>Load</button>{#if ontrust}{' '}<button type="button" class="ap-media-ask-btn" aria-label="Always load from {host}" title="Always load from {host}: adds it to Trusted origins" onclick={ontrust}>Always load</button>{/if}</span>
