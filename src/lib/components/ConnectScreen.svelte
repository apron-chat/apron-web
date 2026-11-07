<script lang="ts">
	/** The connect screen: which backend, its welcome, and the sign-in panel for it. */
	import { serverLook, type ChatClient } from '$lib/protocol/client';
	import { PROTOCOL_VERSION } from '$lib/protocol/client-internals';
	import type { ServerParams } from '$lib/protocol/types';
	import { backendHost } from '$lib/ui/connection';
	import { renderMarkdown } from '$lib/protocol/markdown';
	import { directory } from '$lib/ui/directory.svelte';
	import type { SessionView } from '$lib/ui/session.svelte';
	import { versionWarning, type ConnectStep, type Scheme, type SignOutHandler } from '$lib/ui/sign-in';
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
		/** Opens at choosing the server, as Connect to another server… and a link's server do. */
		initialChoosing?: boolean;
		/** A link's destination on a server it offers (issue #32): said while that server is in the field, before it is contacted. */
		linked?: { server: string; room: string };
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
		initialScheme, initialEmail, initialError, initialChoosing, linked, onconnect, onconnected, oncancel, onsignout
	}: Props = $props();

	let busy = $state(false);
	let signIn = $state<ReturnType<typeof SignIn>>();
	/** Each recent server by its title, else its host, with its address. */
	let recent = $derived(recentServers.map((entry) => ({ url: entry.url, label: entry.title ?? (backendHost(entry.url) || entry.url), avatar: directory.avatarGateFor(entry.url).src(entry.avatar) })));

	/** CommonMark from a server (its welcome, its description), sanitized as a message is. */
	function markdown(text: string | undefined): string {
		return text ? renderMarkdown(text, directory.resolve, directory.resolveRoom, undefined, directory.resolveEmoji, directory.mediaGate) : '';
	}

	/** How the server that answered shows itself (§3.1): its title, else its host, always with its address beside it (§5.3). */
	function shown(server: ServerParams, address: string) {
		const look = serverLook(server, address);
		const gate = address === client.url ? directory.avatarGate : directory.avatarGateFor(address);
		return { name: look.title ?? (backendHost(address) || address), address, avatar: gate.src(look.avatar) };
	}
</script>

<!-- The design system's ConnectPage draws the page; the app's SignIn runs the form, with a ConnectHeader at its top. -->
{#snippet header(step: ConnectStep)}
	{@const welcome = markdown(step.server?.welcome)}
	{@const description = step.server ? markdown(serverLook(step.server, step.address).description) : ''}
	{#snippet welcomeHtml()}{@html welcome}{/snippet}
	{#snippet descriptionHtml()}{@html description}{/snippet}
	<ConnectHeader
		bind:url={serverInput} {busy} welcome={welcome ? welcomeHtml : undefined} urlTestid="server-url-input"
		server={step.server ? shown(step.server, step.address) : undefined} description={description ? descriptionHtml : undefined} serverTestid="connect-server"
		onchange={step.onchange} linked={linked && linked.server === step.address ? `#${linked.room}` : undefined}
		warning={step.server ? versionWarning(step.server.apron, PROTOCOL_VERSION) : undefined}
	/>
{/snippet}
<ConnectPage page {busy} {recent} onpickrecent={(picked) => void signIn?.continueTo(picked.url)}>
	<SignIn
		bind:this={signIn}
		{client} {session} bind:serverInput bind:displayName bind:busy {passkeyUnavailable} {canCancel}
		{initialScheme} {initialEmail} {initialError} {initialChoosing} {header} {onconnect} {onconnected} {oncancel} {onsignout}
	/>
</ConnectPage>
