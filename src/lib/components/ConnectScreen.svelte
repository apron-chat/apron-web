<script lang="ts">
	/** The connect screen: which backend, its welcome, and the sign-in panel for it. */
	import { normalizeWebSocketUrl, serverLook, type ChatClient } from '$lib/protocol/client';
	import { backendHost } from '$lib/ui/connection';
	import { renderMarkdown } from '$lib/protocol/markdown';
	import { directory } from '$lib/ui/directory.svelte';
	import type { SessionView } from '$lib/ui/session.svelte';
	import type { Scheme, SignOutHandler } from '$lib/ui/sign-in';
	import type { RecentServer } from '$lib/ui/storage';
	import ConnectHeader from '$lib/design/components/ConnectHeader.svelte';
	import ConnectPage from '$lib/design/components/ConnectPage.svelte';
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
		/** Prefills the email field. */
		initialEmail?: string;
		/** Shows an error to start with, e.g. why a sign-in link failed. */
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
	/** The server in the field has answered: what it says about itself is for it. */
	let answered = $derived(normalizedInput === client.url && session.server !== undefined);
	/** `server.welcome` (§3.2), for the server in the field once it has answered: CommonMark, sanitized as a message is. */
	let welcome = $derived.by(() => {
		const text = answered ? session.server?.welcome : undefined;
		return text ? renderMarkdown(text, directory.resolve, directory.resolveRoom, undefined, directory.resolveEmoji) : '';
	});
	/** How it shows itself (§3.1): its title, else its host, always with its address beside it (§5.3). */
	let look = $derived(answered ? serverLook(session.server, client.url) : undefined);
	let server = $derived(look ? { name: look.title ?? (backendHost(client.url) || client.url), address: client.url, ...(look.avatar ? { avatar: look.avatar } : {}) } : undefined);
	let description = $derived(look?.description ? renderMarkdown(look.description, directory.resolve, directory.resolveRoom, undefined, directory.resolveEmoji) : '');
	/** Each recent server by its title, else its host, with its address. */
	let recent = $derived(recentServers.map((entry) => ({ url: entry.url, label: entry.title ?? (backendHost(entry.url) || entry.url), ...(entry.avatar ? { avatar: entry.avatar } : {}) })));
</script>

<!-- The design system's ConnectPage draws the page; the app's SignIn runs the form, with a ConnectHeader at its top. -->
{#snippet welcomeHtml()}{@html welcome}{/snippet}
{#snippet descriptionHtml()}{@html description}{/snippet}
{#snippet header()}
	<ConnectHeader bind:url={serverInput} {busy} welcome={welcome ? welcomeHtml : undefined} urlTestid="server-url-input" {server} description={description ? descriptionHtml : undefined} serverTestid="connect-server" />
{/snippet}
<ConnectPage page {busy} {recent} onpickrecent={(picked) => (serverInput = picked.url)}>
	<SignIn
		{client} {session} bind:serverInput bind:displayName bind:busy {passkeyUnavailable} {canCancel}
		{initialScheme} {initialEmail} {initialError} {header} {onconnect} {onconnected} {oncancel} {onsignout}
	/>
</ConnectPage>
