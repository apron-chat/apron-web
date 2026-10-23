<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import StatusDot from './StatusDot.svelte';
	import type { Presence } from './types';
	import { initials, presence } from './util';

	/** Other attributes (`data-*`, `class`, …) go on its outermost element: the image or initials, or the box holding them and the status dot. */
	interface Props extends HTMLAttributes<HTMLElement> {
		name?: string;
		user_id?: string;
		src?: string;
		size?: 'lg' | 'md' | 'sm';
		/** The user's `status` (§4.5): a StatusDot on the bottom-right corner, cut out of the avatar. Absent shows none. */
		status?: Presence | (string & {});
		/** The dot's tooltip, instead of the status's own words ("Invisible · others see you as offline"). */
		statusLabel?: string;
	}
	let { name, user_id, src, size = 'md', status, statusLabel, class: className, ...rest }: Props = $props();
	const shown = $derived(name || user_id || '?');
	const dot = $derived(presence(status) !== undefined);
</script>

{#snippet face(attributes: HTMLAttributes<HTMLElement>)}
	{#if src}
		<img alt="" {...attributes} class={['ap-avatar', `ap-avatar-${size}`, attributes.class]} {src} />
	{:else}
		<span aria-hidden="true" {...attributes} class={['ap-avatar', `ap-avatar-${size}`, attributes.class]}>{initials(shown)}</span>
	{/if}
{/snippet}

{#if dot}
	<span {...rest} class={['ap-avatar-status', `ap-avatar-status-${size}`, className]}>{@render face({})}<StatusDot {status} {size} label={statusLabel} decorative /></span>
{:else}
	{@render face({ ...rest, class: className })}
{/if}
