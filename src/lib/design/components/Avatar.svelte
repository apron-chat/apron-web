<script lang="ts">
	import StatusDot from './StatusDot.svelte';
	import type { Presence } from './types';
	import { initials, presence } from './util';

	/**
	 * An image where the user object carries one this client will load (§4.8.6: pass it already checked), else
	 * initials: on a tint of `hue`, such as one made from the `user_id` so people are told apart at a glance, or on the
	 * denim placeholder without one. With a `status` (§4.5), a StatusDot sits on its corner; it is decorative, with
	 * `statusLabel` as its tooltip, so whoever shows the name says the status. `xs` is for a face inside a line of
	 * small text, such as a reply's quote or a link card's title, and is too small to carry a status.
	 */
	interface Props {
		name?: string;
		user_id?: string;
		src?: string;
		size?: 'lg' | 'md' | 'sm' | 'xs';
		/** The initials' tint, 0–360. */
		hue?: number;
		/** The user's `status` (§4.5): a StatusDot on the bottom-right corner, cut out of the avatar. Absent shows none. */
		status?: Presence | (string & {});
		/** The dot's tooltip, instead of the status's own words ("Invisible · others see you as offline"). */
		statusLabel?: string;
	}
	let { name, user_id, src, size = 'md', hue, status, statusLabel }: Props = $props();
</script>

{#snippet face()}
	{#if src}
		<img class="ap-avatar ap-avatar-{size}" alt="" {src} />
	{:else}
		<span class={['ap-avatar', `ap-avatar-${size}`, hue !== undefined && 'ap-avatar-hued']} style:--avatar-hue={hue} aria-hidden="true">{initials(name || user_id || '?')}</span>
	{/if}
{/snippet}

{#if size !== 'xs' && presence(status) !== undefined}
	<span class="ap-avatar-status ap-avatar-status-{size}">{@render face()}<StatusDot {status} {size} label={statusLabel} decorative /></span>
{:else}
	{@render face()}
{/if}
