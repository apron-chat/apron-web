<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import type { ConnectionState, Tone } from './types';

	const STATUS: Record<ConnectionState, [tone: Tone, label: string]> = {
		connected: ['ok', 'Connected'],
		connecting: ['warn', 'Connecting…'],
		reconnecting: ['warn', 'Connection lost. Reconnecting…'],
		waiting: ['warn', 'Server busy'],
		offline: ['danger', 'Offline'],
		denied: ['danger', 'Signed out'],
		error: ['danger', 'Something went wrong']
	};

	interface Props {
		/** The connection's state: the dot's tone and, without `children`, the words. Leave out for any other status, with `tone` and `children`. */
		state?: ConnectionState;
		children?: Snippet;
		/** Seconds left from `data.retry_after`. */
		retryIn?: number;
		action?: Snippet;
		/** The dot's colour, instead of the one `state` gives; `none` draws it uncoloured. Every tone sits beside words that say it. */
		tone?: Tone | 'none';
		/** `alert` for an error that interrupts, `note` for one that stays. */
		role?: 'status' | 'alert' | 'note';
		/** Announce changes to the words to assistive tech (`aria-live="polite"`). */
		live?: boolean;
		/** A `data-testid` for the words. */
		textTestid?: string;
		/** Classes for the banner, added to its own. */
		class?: ClassValue;
	}
	let { state, children, retryIn, action, tone: toneProp, role = 'status', live, textTestid, class: className }: Props = $props();
	const s = $derived(state ? (STATUS[state] ?? STATUS.connecting) : undefined);
	const tone = $derived(toneProp ?? s?.[0] ?? 'none');
</script>

<div {role} class={['ap-status', action && 'ap-status-action', className]}>
	<span class={['ap-status-dot', tone !== 'none' && `ap-status-${tone}`]} aria-hidden="true"></span>
	<span class="ap-status-text" data-testid={textTestid} aria-live={live ? 'polite' : undefined}>{#if children}{@render children()}{:else}{s?.[1]}{/if}{#if retryIn != null}<span class="ap-status-retry">{` · Retrying in ${retryIn}s`}</span>{/if}</span>
	{@render action?.()}
</div>
