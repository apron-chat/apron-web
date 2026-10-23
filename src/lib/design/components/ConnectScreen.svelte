<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import ConnectHeader from './ConnectHeader.svelte';
	import ConnectPage from './ConnectPage.svelte';
	import SignInForm from './SignInForm.svelte';

	const HINTS: Record<string, string> = {
		guest: 'No token needed; the server picks a guest identity.',
		token: 'Paste the token this backend gave you.',
		email: 'We email you a code to sign in with; the link in the email signs you in too.',
		external: 'Signs in on the server’s own sign-in page (such as single sign-on), which then brings you back here.'
	};

	/**
	 * A whole connect screen run by its props: a ConnectPage holding a SignInForm, with a ConnectHeader at its top.
	 * A client with its own sign-in flow renders those three itself. Extra attributes go on the page.
	 */
	interface Props extends HTMLAttributes<HTMLDivElement> {
		status?: 'idle' | 'connecting' | 'authing';
		/** `bind:url`, `bind:name`, `bind:scheme`, `bind:token` */
		url?: string;
		/** Sent as `name` in the `auth` request (§3.2); `you.name` is the answer. */
		name?: string;
		/** Defaults to guest / token / webauthn. Narrow it to the `server` frame's `auth`, in its order, once known. */
		schemes?: string[];
		scheme?: string;
		token?: string;
		/** `server.welcome` (§3.2): its Markdown, rendered and sanitized by you, shown above the fields. Each `server` frame replaces it. */
		welcome?: Snippet;
		/** Email sign-in (§4.11): `bind:email`, and `bind:code` once `codeSent`. */
		email?: string;
		code?: string;
		/** The server was asked to send a code (an `auth` with `email` and no `token`); the code field shows. */
		codeSent?: boolean;
		/** Use another address, or send a new code: gives up the code asked for. */
		onrestart?: () => void;
		onconnect?: () => void;
		/**
		 * What passkeys do on this server (§3.1: `auth` signs in, `signup` creates an account); both until it
		 * has answered. Where they do both, Passkey asks Sign in or Create account (`bind:passkeyMode`), never a guess.
		 */
		passkey?: { signIn?: boolean; signUp?: boolean };
		/** On Passkey, `login` (sign in with a saved passkey; no display name asked) or `register` (a new account, named by the display name). */
		passkeyMode?: 'login' | 'register';
		/** A passkey action's tap: run the WebAuthn ceremony (§4.10), connecting first where needed. */
		onpasskey?: (action: 'login' | 'register') => void;
		/** Shown in place of the hint, e.g. "Connected. Tap again to continue with your passkey." */
		notice?: string;
		/** The server's error `message` when it gave one (§1.1). */
		error?: string;
		/** Shows Cancel beside the submit, such as when there is a session to go back to. */
		oncancel?: () => void;
		/** Something is under way: the Server field and the recent backends wait. Defaults to whether `status` is connecting or authing. */
		busy?: boolean;
		recent?: Array<{ url: string; label?: string }>;
		onpickrecent?: (r: { url: string; label?: string }) => void;
		/** Fills the viewport, as the app's whole page. */
		page?: boolean;
	}
	let {
		status = 'idle', url = $bindable(''), name = $bindable(''), schemes = ['guest', 'token', 'webauthn'], scheme = $bindable(), token = $bindable(''),
		welcome, email = $bindable(''), code = $bindable(''), codeSent = false, onrestart, onconnect, passkey = {}, passkeyMode = $bindable('login'), onpasskey, notice, error, oncancel,
		busy: waiting, recent, onpickrecent, page = false, ...rest
	}: Props = $props();
	const busy = $derived(waiting ?? (status === 'connecting' || status === 'authing'));
	const current = $derived(scheme || schemes[0]);
	const signIn = $derived(passkey.signIn !== false);
	const signUp = $derived(passkey.signUp !== false);
	/** On Passkey, the action the submit runs: the one chosen, unless passkeys here only do the other. */
	const passkeyAction = $derived<'login' | 'register'>(!signIn ? 'register' : !signUp ? 'login' : passkeyMode);
	/** Signing in with a passkey restores an account, name and all: no display name to ask. */
	const askName = $derived(!(current === 'webauthn' && passkeyAction === 'login'));
	const hint = $derived.by(() => {
		if (notice) return notice;
		if (current !== 'webauthn') return HINTS[current] ?? 'A sign-in Apron doesn’t know; it will try anyway.';
		if (passkeyAction === 'register') return 'Creates an account and saves a new passkey for it on this device. Your display name names both.';
		return 'Your device lists the passkeys saved for this server: pick one to sign in to its account.' + (signUp ? '' : ' New here? Create an account another way first.');
	});
	function submit(event: SubmitEvent): void {
		event.preventDefault();
		if (current === 'webauthn') onpasskey?.(passkeyAction);
		else onconnect?.();
	}
</script>

<ConnectPage {...rest} {recent} {onpickrecent} {busy} {page}>
	<SignInForm
		{schemes} scheme={current} onscheme={(k) => (scheme = k)} passkeyChoice={current === 'webauthn' && signIn && signUp} {passkeyMode} onpasskeymode={(k) => (passkeyMode = k)}
		bind:token bind:email bind:code bind:name {askName} sent={codeSent && current === 'email' ? { scheme: 'email', email } : undefined} {onrestart}
		{hint} hintStatus={Boolean(notice)} {error} {busy} secondary={oncancel && { label: 'Cancel', onclick: oncancel }} onsubmit={submit}
		submit={status === 'connecting' ? 'Connecting…' : status === 'authing' ? 'Signing in…' : current === 'email' ? (codeSent ? 'Sign in' : 'Email me a code') : current === 'webauthn' ? (passkeyAction === 'login' ? 'Sign in with passkey' : 'Create account with passkey') : 'Connect'}
	>
		{#snippet header()}<ConnectHeader bind:url {welcome} {busy} />{/snippet}
	</SignInForm>
</ConnectPage>
