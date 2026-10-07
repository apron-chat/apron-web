<script lang="ts">
	/** The connect screen: which backend, its welcome, and the sign-in panel for it. */
	import { normalizeWebSocketUrl, type ChatClient } from '$lib/protocol/client';
	import { renderMarkdown } from '$lib/protocol/markdown';
	import { directory } from '$lib/ui/directory.svelte';
	import { initials } from '$lib/ui/messages';
	import type { SessionView } from '$lib/ui/session.svelte';
	import type { Scheme, SignOutHandler } from '$lib/ui/sign-in';
	import type { RecentServer } from '$lib/ui/storage';
	import SignIn from './SignIn.svelte';

	interface Props {
		client: ChatClient;
		session: SessionView;
		serverInput: string;
		displayName: string;
		/** Why passkeys can't be used in this browser, when they can't. */
		passkeyUnavailable?: string;
		recentServers: RecentServer[];
		canCancel: boolean;
		/** Preselects a scheme, e.g. when the profile asks to sign in with a passkey. */
		initialScheme?: Scheme;
		/** Prefills the email field, e.g. after an emailed sign-in link failed. */
		initialEmail?: string;
		/** Shows an error to start with, e.g. why an emailed sign-in link failed. */
		initialError?: string;
		/** The form was submitted for another backend: the page drops whatever belonged to the previous one. */
		onconnect: () => void;
		/** The socket is up and signed in. */
		onconnected: () => void;
		oncancel: () => void;
		/** Signing out starts a different session: the page drops what it held from this one. */
		onsignout: SignOutHandler;
	}
	let {
		client, session, serverInput = $bindable(), displayName = $bindable(), passkeyUnavailable, recentServers, canCancel,
		initialScheme, initialEmail, initialError, onconnect, onconnected, oncancel, onsignout
	}: Props = $props();

	let busy = $state(false);
	let normalizedInput = $derived.by(() => {
		try {
			return normalizeWebSocketUrl(serverInput, window.location);
		} catch {
			return serverInput.trim();
		}
	});
	/** `server.welcome` (§3.2), for the server in the field once it has answered: CommonMark, sanitized as a message is. */
	let welcome = $derived.by(() => {
		const text = normalizedInput === client.url ? session.server?.welcome : undefined;
		return text ? renderMarkdown(text, directory.resolve, directory.resolveRoom) : '';
	});
</script>

<div class="app ap-connect">
	<SignIn
		{client} {session} bind:serverInput bind:displayName bind:busy {passkeyUnavailable} {canCancel}
		{initialScheme} {initialEmail} {initialError} {onconnect} {onconnected} {oncancel} {onsignout}
	>
		{#snippet header()}
			<h1 class="ap-connect-title">Apron</h1>
			<p class="ap-connect-tag">Connect to a backend</p>
			{#if welcome}<div class="ap-welcome ap-msg-text" data-testid="server-welcome">{@html welcome}</div>{/if}
			<label class="ap-fieldlabel">Server
				<input class="ap-field ap-field-mono" data-testid="server-url-input" type="text" inputmode="url" bind:value={serverInput} placeholder="wss://server.apron.chat/" disabled={busy} autocomplete="url" spellcheck="false" />
			</label>
		{/snippet}
	</SignIn>
	{#if recentServers.length > 0}
		<div class="ap-connect-recent" role="group" aria-label="Recent backends">
			<span class="ap-fieldlabel">Recent</span>
			{#each recentServers as recent (recent.url)}
				<button class="ap-connect-recent-item" type="button" disabled={busy} onclick={() => (serverInput = recent.url)}>
					<span class="ap-rail-tile ap-connect-tile" aria-hidden="true">{initials(recent.label || recent.url)}</span>
					<span class="ap-room-text">
						<span class="ap-room-name">{recent.label || recent.url}</span>
						<span class="ap-room-topic">{recent.url}</span>
					</span>
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.app { height: 100dvh; min-height: 100%; }
</style>
