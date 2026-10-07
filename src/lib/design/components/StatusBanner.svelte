<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ConnectionState } from './types';

	const STATUS: Record<ConnectionState, [tone: 'ok' | 'warn' | 'danger', label: string]> = {
		connected: ['ok', 'Connected'],
		connecting: ['warn', 'Connecting…'],
		reconnecting: ['warn', 'Connection lost. Reconnecting…'],
		waiting: ['warn', 'Server busy'],
		offline: ['danger', 'Offline'],
		denied: ['danger', 'Signed out'],
		error: ['danger', 'Something went wrong']
	};

	interface Props {
		state: ConnectionState;
		/** The server's error `message`, shown as is (§1.1). */
		message?: string;
		children?: Snippet;
		/** Seconds left from `data.retry_after`. */
		retryIn?: number;
		action?: Snippet;
	}
	let { state, message, children, retryIn, action }: Props = $props();
	const s = $derived(STATUS[state] ?? STATUS.connecting);
</script>

<div class={['ap-status', action && 'ap-status-action']} role="status">
	<span class="ap-status-dot ap-status-{s[0]}" aria-hidden="true"></span>
	<span class="ap-status-text">{#if children}{@render children()}{:else}{message || s[1]}{/if}{#if retryIn != null}<span class="ap-status-retry">{` · Retrying in ${retryIn}s`}</span>{/if}</span>
	{@render action?.()}
</div>
