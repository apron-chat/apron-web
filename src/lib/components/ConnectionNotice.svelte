<script lang="ts">
	import { statusLabel } from '$lib/ui/connection';
	import type { SessionView } from '$lib/ui/session.svelte';
	import StatusBanner from '$lib/design/components/StatusBanner.svelte';

	/**
	 * The connection's state under an open room's header: a banner while it's
	 * down for long enough to matter, with Try Again (or Sign in) once it needs
	 * you, and otherwise only a live region for screen readers.
	 */
	interface Props {
		session: SessionView;
		/** Try Again, or Sign in when the session was held. */
		onretry: () => void;
	}
	let { session, onretry }: Props = $props();
	let snapshot = $derived(session.snapshot);
</script>

{#if session.connection === 'reconnecting' && !session.reconnectNeedsAttention}
	<!-- A short blip stays quiet: the room, history, and identity are kept in place, and the pill above the composer says it. -->
	<span class="ap-sr" data-testid="connection-status" role="status" aria-live="polite">{statusLabel(snapshot, session.stalled)}</span>
{:else if session.starting && session.connection === 'connecting'}
	<!-- Coming up with a view from before: the timeline's foot says it's checking; a banner would only alarm. -->
	<span class="ap-sr" data-testid="connection-status" role="status" aria-live="polite">{statusLabel(snapshot, session.stalled)}</span>
{:else if session.connection !== 'connected'}
	<div class="ap-shell-banner">
		<StatusBanner tone={session.connection === 'connecting' ? 'warn' : 'danger'} textTestid="connection-status" live>
			{statusLabel(snapshot, session.stalled)}
			{#snippet action()}
				{#if session.reconnectNeedsAttention}
					<button class="ap-btn ap-btn-sm" type="button" data-testid="reconnect-retry" disabled={Boolean(snapshot.retryAfterMs)} onclick={onretry}>{snapshot.held ? 'Sign in' : 'Try Again'}</button>
				{/if}
			{/snippet}
		</StatusBanner>
	</div>
{:else}
	<span class="ap-sr" data-testid="connection-status" role="status" aria-live="polite">Connected</span>
{/if}
