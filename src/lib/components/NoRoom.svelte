<script lang="ts">
	import EmptyState from '$lib/design/components/EmptyState.svelte';
	import RoomLoading from '$lib/design/components/RoomLoading.svelte';
	import { statusLabel } from '$lib/ui/connection';
	import type { SessionView } from '$lib/ui/session.svelte';
	import StatusBanner from '$lib/design/components/StatusBanner.svelte';

	/** The main pane with no room open: placeholders while the app comes up, then a pointer to the rooms list. */
	interface Props {
		session: SessionView;
		/** Connect to a backend. */
		onconnect: () => void;
		/** The server being connected to, as people read it (`serverLabel`). */
		server?: string;
		/** Stop connecting and choose another server: shown while the connection is still being made. */
		onchangeserver?: () => void;
	}
	let { session, onconnect, server, onchangeserver }: Props = $props();
	let snapshot = $derived(session.snapshot);
</script>

{#if session.starting}
	<!-- Coming up (connecting, signing in, listing rooms): placeholders where the room will be, not "No room open". -->
	<!-- A server that is gone can keep this up for a while: it says which server, and offers another until it answers. -->
	{@const connected = session.connection === 'connected'}
	<RoomLoading label={connected ? 'Loading messages…' : server ? `Connecting to ${server}…` : 'Connecting…'} rows={6} action={!connected && onchangeserver ? changeServer : undefined}>
		<span class="ap-sr" data-testid="connection-status" role="status" aria-live="polite">{statusLabel(snapshot, session.stalled)}</span>
	</RoomLoading>
	{#snippet changeServer()}<button class="ap-btn ap-btn-sm" type="button" data-testid="change-server" onclick={onchangeserver}>Change server</button>{/snippet}
{:else}
	{@const connected = session.connection === 'connected'}
	<EmptyState title={connected ? 'No room open' : undefined} detail={connected ? 'Pick a room from the list.' : undefined}>
		{#if !connected}
			<StatusBanner tone={session.connection === 'offline' ? 'danger' : 'warn'} textTestid="connection-status" live>{statusLabel(snapshot, session.stalled)}</StatusBanner>
		{:else}
			<span class="ap-sr" data-testid="connection-status" role="status" aria-live="polite">Connected</span>
		{/if}
		{#snippet actions()}<button class="ap-btn ap-btn-sm" type="button" onclick={onconnect}>Connect to a backend</button>{/snippet}
	</EmptyState>
{/if}
