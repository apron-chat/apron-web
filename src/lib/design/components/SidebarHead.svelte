<script lang="ts">
	interface Props {
		/** The server the rooms list is for: its name, or its address. */
		name: string;
		/** A Connect button: the connection's settings, or another server. */
		onconnect?: () => void;
		/** Phones: the room or thread the rooms list opened over, and a › back to it, mirroring the room header's ‹. */
		returnTo?: string;
		onreturn?: () => void;
	}
	let { name, onconnect, returnTo, onreturn }: Props = $props();
</script>

<div class="ap-shell-sidehead">
	<span class="ap-shell-sidehead-name">{name}</span>
	{#if onconnect}<button class="ap-btn ap-btn-ghost ap-btn-sm" type="button" aria-label="Connection settings" onclick={onconnect}>Connect</button>{/if}
	{#if returnTo !== undefined && onreturn}
		<button class="ap-shell-sidehead-return" type="button" data-testid="rooms-return" aria-label="Back to {returnTo}" title="Back to {returnTo}" onclick={onreturn}>›</button>
	{/if}
</div>
