<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ConnectionState } from './types';

	type Tone = 'ok' | 'warn' | 'danger';
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
		/** The connection's state: the dot's tone and, without `message` or `children`, the words. Leave out for any other status, with `tone` and `children`. */
		state?: ConnectionState;
		/** The server's error `message`, shown as is (§1.1). */
		message?: string;
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
		/** `data-testid` on the words. */
		testid?: string;
	}
	let { state, message, children, retryIn, action, tone: toneProp, role = 'status', live, testid }: Props = $props();
	const s = $derived(state ? (STATUS[state] ?? STATUS.connecting) : undefined);
	const tone = $derived(toneProp ?? s?.[0] ?? 'none');
</script>

<div class={['ap-status', action && 'ap-status-action']} {role}>
	<span class={['ap-status-dot', tone !== 'none' && `ap-status-${tone}`]} aria-hidden="true"></span>
	<span class="ap-status-text" data-testid={testid} aria-live={live ? 'polite' : undefined}>{#if children}{@render children()}{:else}{message || s?.[1]}{/if}{#if retryIn != null}<span class="ap-status-retry">{` · Retrying in ${retryIn}s`}</span>{/if}</span>
	{@render action?.()}
</div>
