<script lang="ts">
	import type { Snippet } from 'svelte';
	import Button from './Button.svelte';
	import TypingDots from './TypingDots.svelte';
	import { initials } from './util';

	const SCHEME: Record<string, [string, string]> = {
		guest: ['Guest', 'No token needed; the server picks a guest identity.'],
		token: ['Token', 'Paste the token this backend gave you.'],
		webauthn: ['Passkey', 'Sign in with a passkey you already have, or create an account with a new one.'],
		email: ['Email', 'We email you a code to sign in with; the link in the email signs you in too.']
	};

	interface Props {
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
		/** Email sign-in (§4.10): `bind:email`, and `bind:code` once `codeSent`. */
		email?: string;
		code?: string;
		/** The server was asked to send a code (an `auth` with `email` and no `token`); the code field shows. */
		codeSent?: boolean;
		onconnect?: () => void;
		/**
		 * What passkeys do on this server (§3.1: `auth` signs in, `signup` creates an account); both until it
		 * has answered. On Passkey the form offers each as its own action, never a guess between them.
		 */
		passkey?: { signIn?: boolean; signUp?: boolean };
		/** A passkey action's tap: run the WebAuthn ceremony (§4.9), connecting first where needed. */
		onpasskey?: (action: 'login' | 'register') => void;
		/** Shown in place of the hint, e.g. "Connected. Tap again to continue with your passkey." */
		notice?: string;
		/** The server's error `message` when it gave one (§1.1). */
		error?: string;
		recent?: Array<{ url: string; label?: string }>;
		onpickrecent?: (r: { url: string; label?: string }) => void;
	}
	let {
		status = 'idle', url = $bindable(''), name = $bindable(''), schemes = ['guest', 'token', 'webauthn'], scheme = $bindable(), token = $bindable(''),
		welcome, email = $bindable(''), code = $bindable(''), codeSent = false, onconnect, passkey = {}, onpasskey, notice, error, recent, onpickrecent
	}: Props = $props();
	const busy = $derived(status === 'connecting' || status === 'authing');
	const current = $derived(scheme || schemes[0]);
	const signIn = $derived(passkey.signIn !== false);
	const signUp = $derived(passkey.signUp !== false);
	/** On Passkey, the submit button signs in, or creates an account where passkeys only do that. */
	const passkeyAction = $derived<'login' | 'register'>(signIn ? 'login' : 'register');
	function submit(): void {
		if (current === 'webauthn') onpasskey?.(passkeyAction);
		else onconnect?.();
	}
</script>

<div class="ap-connect">
	<form class="ap-connect-card" onsubmit={(e) => { e.preventDefault(); submit(); }}>
		<h1 class="ap-connect-title">Apron</h1>
		<p class="ap-connect-tag">Connect to a backend</p>
		{#if welcome}<div class="ap-welcome ap-msg-text">{@render welcome()}</div>{/if}
		<label class="ap-fieldlabel">Server
			<!-- svelte-ignore a11y_autofocus -->
			<input autofocus class="ap-field ap-field-mono" type="url" inputmode="url" placeholder="wss://chat.example/ws" bind:value={url} disabled={busy} spellcheck="false" autocomplete="url" />
		</label>
		<label class="ap-fieldlabel">Display name
			<input class="ap-field" placeholder="How others see you" bind:value={name} disabled={busy} maxlength="64" autocomplete="nickname" />
		</label>
		<div class="ap-fieldlabel">Sign in with
			<div class="ap-seg" role="radiogroup" aria-label="Sign in with">
				{#each schemes as k (k)}
					<button type="button" role="radio" aria-checked={k === current} class={['ap-seg-item', k === current && 'ap-seg-on']} onclick={() => (scheme = k)} disabled={busy}>{(SCHEME[k] || [k])[0]}</button>
				{/each}
			</div>
		</div>
		{#if current === 'token'}
			<label class="ap-fieldlabel">Token
				<input class="ap-field ap-field-mono" type="password" bind:value={token} disabled={busy} autocomplete="off" spellcheck="false" />
			</label>
		{:else if current === 'email'}
			<label class="ap-fieldlabel">Email
				<input class="ap-field" type="email" bind:value={email} disabled={busy || codeSent} autocomplete="email" spellcheck="false" />
			</label>
			{#if codeSent}
				<label class="ap-fieldlabel">Code
					<input class="ap-field ap-field-mono" inputmode="numeric" bind:value={code} disabled={busy} autocomplete="one-time-code" spellcheck="false" />
				</label>
			{/if}
		{/if}
		<p class="ap-profedit-hint" role={notice ? 'status' : undefined}>{notice || (current === 'webauthn' && !(signIn && signUp)
			? (signIn ? 'Signs in with a passkey already on your account. New here? Create an account another way first.' : 'Creates an account with a new passkey on this device. Your display name names it.')
			: (SCHEME[current] || ['', 'A sign-in Apron doesn’t know; it will try anyway.'])[1])}</p>
		{#if current === 'webauthn' && signIn && signUp}
			<button type="button" class="ap-link ap-connect-other" disabled={busy} onclick={() => onpasskey?.('register')}>New here? Create an account with a passkey</button>
		{/if}
		{#if error}<p class="ap-profedit-note ap-profedit-err" role="alert">{error}</p>{/if}
		<div class="ap-connect-actions">
			{#if busy}<TypingDots />{/if}
			<Button type="submit" variant="primary" disabled={busy} label={status === 'connecting' ? 'Connecting…' : status === 'authing' ? 'Signing in…' : current === 'email' ? (codeSent ? 'Sign in' : 'Email me a code') : current === 'webauthn' ? (passkeyAction === 'login' ? 'Sign in with passkey' : 'Create account with passkey') : 'Connect'} />
		</div>
	</form>
	{#if recent && recent.length}
		<div class="ap-connect-recent">
			<span class="ap-fieldlabel">Recent</span>
			{#each recent as r (r.url)}
				<button type="button" class="ap-connect-recent-item" onclick={() => onpickrecent?.(r)}>
					<span class="ap-rail-tile ap-connect-tile">{initials(r.label || r.url)}</span>
					<span class="ap-room-text"><span class="ap-room-name">{r.label || r.url}</span><span class="ap-room-topic">{r.url}</span></span>
				</button>
			{/each}
		</div>
	{/if}
</div>
