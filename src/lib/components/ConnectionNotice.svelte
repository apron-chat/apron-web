<script lang="ts">
	import { retryUntil, statusLabel } from '$lib/ui/connection';
	import type { SessionView } from '$lib/ui/session.svelte';
	import StatusBanner from '$lib/design/components/StatusBanner.svelte';
	import { secondNow } from '$lib/design/components/clock.svelte';

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
	/** When the server's wait before reconnecting ends, from the snapshot that brought it: nothing emits while it runs. */
	const until = $derived(retryUntil(snapshot));
	/** The wait's time left, counting down a second at a time while it lasts, and not ticking once it's over. */
	const retryLeft = $derived(until !== undefined && until > Date.now() ? Math.max(0, until - secondNow()) : 0);
	const label = $derived(statusLabel(snapshot, session.stalled, retryLeft));
	/** For screen readers, the wait as it came, not each tick: said again only as it ends or the snapshot changes. */
	const spoken = $derived(statusLabel(snapshot, session.stalled, retryLeft > 0 ? snapshot.retryAfterMs : 0));
</script>

{#snippet counted()}{#if retryLeft > 0}<span aria-hidden="true">{label}</span><span class="ap-sr">{spoken}</span>{:else}{label}{/if}{/snippet}

{#if session.connection === 'reconnecting' && !session.reconnectNeedsAttention}
	<!--
		A short blip stays quiet: the room, history, and identity are kept in place, and the pill above the composer says
		it. Its first moments, and a hidden tab's wait, say nothing here either, as the pill doesn't: a quick way back
		isn't announced twice.
	-->
	<span class="ap-sr" data-testid="connection-status" role="status" aria-live="polite">{session.reconnectQuiet || session.waitingToReconnect ? '' : spoken}</span>
{:else if session.starting && session.connection === 'connecting'}
	<!-- Coming up with a view from before: the timeline's foot says it's checking; a banner would only alarm. -->
	<span class="ap-sr" data-testid="connection-status" role="status" aria-live="polite">{spoken}</span>
{:else if session.connection !== 'connected'}
	<div class="ap-shell-banner">
		<StatusBanner tone={session.connection === 'connecting' ? 'warn' : 'danger'} textTestid="connection-status" live>
			{@render counted()}
			{#snippet action()}
				{#if session.reconnectNeedsAttention}
					<button class="ap-btn ap-btn-sm" type="button" disabled={retryLeft > 0} onclick={onretry}>{snapshot.held ? 'Sign in' : 'Try Again'}</button>
				{/if}
			{/snippet}
		</StatusBanner>
	</div>
{:else}
	<span class="ap-sr" data-testid="connection-status" role="status" aria-live="polite">Connected</span>
{/if}
