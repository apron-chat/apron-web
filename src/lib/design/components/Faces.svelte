<script lang="ts">
	import type { ClassValue } from 'svelte/elements';
	import Avatar from './Avatar.svelte';
	import type { Face } from './types';

	/**
	 * Who a private room is with: one person's avatar with their status (§4.5), or the first two of a group, the
	 * second stacked behind the first, without statuses. Decorative: whatever shows the room's name says who.
	 */
	interface Props {
		people: Face[];
		size?: 'sm' | 'md' | 'lg';
		/** Classes for its root, added to its own. */
		class?: ClassValue;
	}
	let { people, size = 'sm', class: className }: Props = $props();
	const shown = $derived(people.slice(0, 2));
</script>

{#if shown.length === 1}
	{@const face = shown[0]}
	<span class={['ap-faces', `ap-faces-${size}`, className]} aria-hidden="true"><Avatar name={face.name || face.user_id} src={face.src} hue={face.hue} {size} status={face.status} statusLabel={face.statusLabel} /></span>
{:else if shown.length > 1}
	<span class={['ap-faces', `ap-faces-${size}`, 'ap-faces-group', className]} aria-hidden="true">
		{#each shown as face (face.user_id)}<Avatar name={face.name || face.user_id} src={face.src} hue={face.hue} {size} />{/each}
	</span>
{/if}
