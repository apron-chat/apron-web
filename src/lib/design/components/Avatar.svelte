<script lang="ts">
	import StatusDot from './StatusDot.svelte';
	import type { Presence } from './types';
	import { initials, presence } from './util';

	interface Props {
		name?: string;
		user_id?: string;
		src?: string;
		size?: 'lg' | 'md' | 'sm';
		/** The user's `status` (§4.11): a StatusDot on the bottom-right corner, cut out of the avatar. Absent shows none. */
		status?: Presence | (string & {});
		/** The dot's tooltip, instead of the status's own words ("Invisible · others see you as offline"). */
		statusLabel?: string;
	}
	let { name, user_id, src, size = 'md', status, statusLabel }: Props = $props();
	const shown = $derived(name || user_id || '?');
	const dot = $derived(presence(status) !== undefined);
</script>

{#snippet face()}
	{#if src}
		<img class="ap-avatar ap-avatar-{size}" {src} alt="" />
	{:else}
		<span class="ap-avatar ap-avatar-{size}" aria-hidden="true">{initials(shown)}</span>
	{/if}
{/snippet}

{#if dot}
	<span class="ap-avatar-status ap-avatar-status-{size}">{@render face()}<StatusDot {status} {size} label={statusLabel} decorative /></span>
{:else}
	{@render face()}
{/if}
