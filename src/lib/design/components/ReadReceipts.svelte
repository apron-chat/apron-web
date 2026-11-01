<script lang="ts">
	import type { ClassValue } from 'svelte/elements';
	import Avatar from './Avatar.svelte';
	import type { Face } from './types';

	/**
	 * Read receipts under a message (§4.6, a private room's members): the faces of those who have read up to it
	 * and no further, the first three overlapping and then a count, named in full on hover and for assistive tech.
	 */
	interface Props {
		people: Face[];
		/**
		 * Hidden from assistive tech, keeping only the tooltip: inside a live region such as the timeline's log, where
		 * each move of someone's cursor would otherwise be announced.
		 */
		decorative?: boolean;
		testid?: string;
		/** Classes for its root, added to its own. */
		class?: ClassValue;
	}
	let { people, decorative = false, testid, class: className }: Props = $props();
	const shown = $derived(people.slice(0, 3));
	const more = $derived(people.length - shown.length);
	const names = $derived(people.map((face) => face.name || face.user_id));
	const label = $derived(`Seen by ${names.length <= 3 ? list(names) : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`}`);

	function list(items: string[]): string {
		return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
	}
</script>

{#if people.length}
	<div class={['ap-receipts', className]} role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : label} aria-hidden={decorative || undefined} title={label} data-testid={testid}>
		{#each shown as face (face.user_id)}<Avatar name={face.name || face.user_id} src={face.src} hue={face.hue} size="xs" />{/each}
		{#if more > 0}<span class="ap-receipts-more" aria-hidden="true">+{more}</span>{/if}
	</div>
{/if}
