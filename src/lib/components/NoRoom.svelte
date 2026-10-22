<script lang="ts">
	import EmptyState from '$lib/design/components/EmptyState.svelte';
	import RoomLoading from '$lib/design/components/RoomLoading.svelte';
	import { statusLabel } from '$lib/ui/connection';
	import type { SessionView } from '$lib/ui/session.svelte';
	import StatusBanner from './StatusBanner.svelte';

	/** The main pane with no room open: placeholders while the app comes up, then a pointer to the rooms list. */
	interface Props {
		session: SessionView;
		/** Connect to a backend. */
		onconnect: () => void;
	}
	let { session, onconnect }: Props = $props();
	let snapshot = $derived(session.snapshot);
</script>

{#if session.starting}
	<!-- Coming up (connecting, signing in, listing rooms): placeholders where the room will be, not "No room open". -->
	<RoomLoading label={session.connection === 'connected' ? 'Loading messages…' : 'Connecting…'} rows={6}>
		<span class="ap-sr" data-testid="connection-status" role="status" aria-live="polite">{statusLabel(snapshot, session.stalled)}</span>
	</RoomLoading>
{:else}
	{@const connected = session.connection === 'connected'}
	<EmptyState title={connected ? 'No room open' : undefined} detail={connected ? 'Pick a room from the list.' : undefined}>
		{#if !connected}
			<StatusBanner tone={session.connection === 'offline' ? 'danger' : 'warn'} testid="connection-status" live>{statusLabel(snapshot, session.stalled)}</StatusBanner>
		{:else}
			<span class="ap-sr" data-testid="connection-status" role="status" aria-live="polite">Connected</span>
		{/if}
		{#snippet actions()}<button class="ap-btn ap-btn-sm" type="button" onclick={onconnect}>Connect to a backend</button>{/snippet}
	</EmptyState>
{/if}
