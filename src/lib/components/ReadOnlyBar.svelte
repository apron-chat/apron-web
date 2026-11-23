<script lang="ts">
	import Button from '$lib/design/components/Button.svelte';

	/**
	 * Stands in for the composer while you only read (`ext:permissions` with
	 * `write: false`): says why, and offers a guest the passkey sign-in that
	 * may lift it. Rooms can still be listed and read, without joining.
	 */
	interface Props {
		/** You read as a guest: signing in may let you post. */
		guest: boolean;
		/** Why passkeys can't be used in this browser, when they can't. */
		passkeyUnavailable?: string;
		/** Reading an archive (`ext:archive`): what it is, said in place of the guest's line, with no sign-in to offer. */
		archive?: string;
		/**
		 * Signed out: the server denied the connection (§1.1) or waits for a sign-in, and nothing reconnects until you
		 * sign in. Said in place of the rest, with Sign in.
		 */
		signedOut?: boolean;
		onsignin: () => void;
	}
	let { guest, passkeyUnavailable, archive, signedOut = false, onsignin }: Props = $props();
</script>

<div class="ap-composer ap-composer-readonly" role="note">
	<p class="ap-composer-readonly-text">
		{#if signedOut}
			You’re signed out, so nothing can be sent here. Sign in to go on.
		{:else if archive}
			{archive}
		{:else if guest}
			You’re reading as a guest. {passkeyUnavailable ? `Posting needs a passkey sign-in. ${passkeyUnavailable}` : 'Sign in to post, react, join rooms, and start threads.'}
		{:else}
			You can read here, but this server doesn’t let you post, react, or join rooms.
		{/if}
	</p>
	{#if signedOut || (guest && !passkeyUnavailable && !archive)}
		<Button variant="primary" size="sm" onclick={onsignin} label="Sign in" />
	{/if}
</div>
