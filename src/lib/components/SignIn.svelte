<script lang="ts">
	/**
	 * The one sign-in panel: picks a scheme the server offers, connects to the
	 * server in `serverInput` when it isn't the connected one, and runs one
	 * explicit action per tap (see `$lib/ui/sign-in`). Every way into signing
	 * in (the connect screen, the profile, the read-only bar, a session held
	 * for a sign-in) lands here, so there is one flow to keep right.
	 */
	import { onDestroy, untrack, type Snippet } from 'svelte';
	import { normalizeWebSocketUrl, serverSettings, type ChatClient } from '$lib/protocol/client';
	import { offeredSchemes, passkeyMessage, schemeUse } from '$lib/ui/connection';
	import { codeStillFor, type SentCode } from '$lib/ui/email-link';
	import type { SessionView } from '$lib/ui/session.svelte';
	import { passkeyChoice, passkeyMode, signInHint, signInView, signOutThen, type PasskeyMode, type SignOutHandler, type Scheme } from '$lib/ui/sign-in';
	import { saveDisplayName, saveServerUrl } from '$lib/ui/storage';
	import TypingDots from './TypingDots.svelte';

	const LABELS: Record<Scheme, string> = { guest: 'Guest', webauthn: 'Passkey', email: 'Email', token: 'Token' };
	/** On Passkey, the two paths: each a title and what it does. */
	const PASSKEY_CHOICES: Array<[PasskeyMode, string, string]> = [
		['login', 'Sign in', 'I have a passkey'],
		['register', 'Create account', 'I’m new here']
	];
	/** Every scheme this client can drive, in the order shown when the server's list isn't known yet. */
	const KNOWN_SCHEMES = Object.keys(LABELS) as Scheme[];

	interface Props {
		client: ChatClient;
		session: SessionView;
		/** The server to sign in to, as typed: the host may let the user edit it (`header`). */
		serverInput: string;
		displayName: string;
		/** Something is under way: the host disables what would change the server meanwhile. */
		busy?: boolean;
		/** Why passkeys can't be used in this browser, when they can't. */
		passkeyUnavailable?: string;
		canCancel: boolean;
		/** Preselects a scheme, e.g. when the profile asks to sign in with a passkey. */
		initialScheme?: Scheme;
		/** On Passkey, preselects Sign in (the default) or Create account. */
		initialPasskey?: PasskeyMode;
		/** Prefills the email field, e.g. after an emailed sign-in link failed. */
		initialEmail?: string;
		/** Shows an error to start with, e.g. why an emailed sign-in link failed. */
		initialError?: string;
		/** Shown at the top of the form, such as the host's title and server field. */
		header?: Snippet;
		/** The form was submitted for another backend: the page drops whatever belonged to the previous one. */
		onconnect: () => void;
		/** The socket is up and signed in. */
		onconnected: () => void;
		oncancel: () => void;
		/** Signing out starts a different session: the page drops what it held from this one. */
		onsignout: SignOutHandler;
	}
	let {
		client, session, serverInput = $bindable(), displayName = $bindable(), busy = $bindable(false), passkeyUnavailable, canCancel,
		initialScheme, initialPasskey, initialEmail, initialError, header, onconnect, onconnected, oncancel, onsignout
	}: Props = $props();

	// The initial choice follows the request or the current session; the segmented control owns it from then on.
	let scheme = $state<Scheme>(untrack(() => initialScheme ?? (session.snapshot.passkeySession ? 'webauthn' : 'guest')));
	/** On Passkey, Sign in or Create account: the viewer picks, the panel never guesses. */
	let passkeyChosen = $state<PasskeyMode>(untrack(() => initialPasskey ?? 'login'));
	/** Waiting for the connection this panel opened to the server in the form. */
	let pending = $state(false);
	/** That connection signed in as a guest, which the passkey step can leave as it is. */
	let joinedAsGuest = $state(false);
	/** The passkey action a tap asked for before there was a connection for it: it runs once there is. */
	let intent = $state<'login' | 'register' | undefined>();
	let error = $state(untrack(() => initialError ?? ''));
	/** What to do next, in place of the hint: the browser refused a sheet that followed a connection. */
	let notice = $state('');
	/** Email sign-in (§4.11): the address, and the code once the server was asked to send one. */
	let email = $state(untrack(() => initialEmail ?? ''));
	let code = $state('');
	/**
	 * The address a code was requested for, and the server that will send it:
	 * the code field shows while it is set, and the code only ever goes back to
	 * the connection that proposed it, on that server (§4.11). Changing the
	 * Server field drops it, and so does that connection closing.
	 */
	let codeSent = $state<SentCode | undefined>();
	let codeSentTo = $derived(codeSent?.email);
	let emailBusy = $state(false);
	/** The pasted token for the Token scheme; cleared once handed to the client. */
	let token = $state('');
	/** A sign-up invite from `/invite`: it creates an account, named as asked, the server picking its user_id from the name. */
	let inviteToken = $derived(token.trim().startsWith('apron_join_'));
	let snapshot = $derived(session.snapshot);
	let normalizedInput = $derived.by(() => {
		try {
			return normalizeWebSocketUrl(serverInput, window.location);
		} catch {
			return serverInput.trim();
		}
	});
	/** `client.url` isn't reactive: read it again whenever the client reports a change, as switching servers does. */
	let sameServer = $derived.by(() => {
		void snapshot;
		return normalizedInput === client.url;
	});
	/** Signed in to the server in the form, so sign-in can happen in place. */
	let here = $derived(sameServer && snapshot.status === 'connected' && snapshot.authenticated);
	let registered = $derived(!!snapshot.passkeySession);
	/**
	 * The sign-in schemes the server in the field advertises, in its order,
	 * that this client can drive (passkeys only where the browser has them).
	 * Until that server has answered, every scheme the client knows.
	 */
	let schemes = $derived.by((): Scheme[] => {
		const offered = sameServer && session.server ? offeredSchemes(session.server) : undefined;
		const listed = offered ? offered.filter((candidate): candidate is Scheme => Object.hasOwn(LABELS, candidate)) : KNOWN_SCHEMES;
		const usable = listed.filter((candidate) => candidate !== 'webauthn' || !passkeyUnavailable);
		return usable.length ? usable : ['guest'];
	});
	let chosen = $derived(schemes.includes(scheme) ? scheme : schemes[0]);
	/** The server in the field, once it has answered. */
	let known = $derived(sameServer ? session.server : undefined);
	/** Whether the chosen scheme signs in, creates an account, or both (`server.signup`, §3.1); unknown servers get both. */
	let use = $derived(known ? schemeUse(known, chosen) : { signIn: true, signUp: true });
	/** The server in the field is the connected one, and its guests only read (`ext:settings`). */
	let guestReadOnly = $derived(sameServer && !serverSettings(session.server).guest_posting);
	/** The passkey action a tap runs: the one chosen, where the server lets passkeys do it. */
	let mode = $derived(passkeyMode(use, passkeyChosen));
	let view = $derived(signInView({
		scheme: chosen,
		use,
		passkey: passkeyChosen,
		sameServer,
		status: snapshot.status,
		serverKnown: Boolean(known),
		authenticated: snapshot.authenticated,
		registered,
		connectionError: Boolean(snapshot.error),
		pending,
		busy: Boolean(snapshot.authBusy) || emailBusy,
		codeSent: Boolean(codeSentTo)
	}));
	/**
	 * Signing in with a passkey restores an account, name and all: the form
	 * asks no display name for it, and none is applied to that account.
	 */
	let passkeyLogin = $derived(chosen === 'webauthn' && mode === 'login' && !(here && registered));
	let hint = $derived(signInHint({ scheme: chosen, use, passkey: passkeyChosen, registered, phase: view.phase, here, guest: here && !registered, guestReadOnly, invite: inviteToken }));
	$effect(() => {
		busy = view.phase === 'busy' || view.phase === 'connecting';
	});
	let errorText = $derived.by(() => {
		if (error) return error;
		if (!pending || !snapshot.error) return '';
		return snapshot.error === 'WebSocket connection error' ? 'Can’t reach the server. Check the address and try again.' : snapshot.error;
	});

	// An error is about the server it happened on: naming another one clears it.
	let errorServer = untrack(() => normalizedInput);
	$effect(() => {
		if (normalizedInput === errorServer) return;
		errorServer = normalizedInput;
		untrack(() => (error = ''));
	});

	// A code belongs to the server that sent it: editing the Server field away from it drops the code.
	$effect(() => {
		if (codeSent && codeSent.url !== normalizedInput) untrack(() => {
			codeSent = undefined;
			code = '';
			client.cancelEmailCode();
		});
	});

	// Closing the panel, however it closes, gives up a code still waiting: nothing here could take it any more.
	onDestroy(() => client.cancelEmailCode());

	// A code works only on the connection that asked for it: once that closes (expired, dropped), ask again.
	$effect(() => {
		if (!codeSent || emailBusy || snapshot.emailCode) return;
		untrack(() => {
			codeSent = undefined;
			code = '';
			error = 'The request for that code has closed (it expired, or the connection dropped). Send a new code.';
		});
	});

	// The connection this panel opened has settled. The passkey action that opened it runs now; without
	// one, a passkey waits for a tap. Everything else is done once signed in.
	$effect(() => {
		if (!pending || chosen === 'email') return;
		if (chosen === 'webauthn' ? view.phase !== 'ready' && !here : !session.ready || snapshot.authBusy) return;
		untrack(() => {
			pending = false;
			const asked = intent;
			intent = undefined;
			if (chosen === 'webauthn' && !registered) {
				joinedAsGuest = here;
				// Only what this server lets passkeys do: otherwise the panel shows what it does.
				if (asked && asked === mode) void passkey(asked, true);
				return;
			}
			finish();
		});
	});

	function submit(event: SubmitEvent): void {
		event.preventDefault();
		error = '';
		const action = view.primary.action;
		if (action === 'passkey-login' || action === 'passkey-register') {
			startPasskey(action === 'passkey-login' ? 'login' : 'register');
			return;
		}
		const normalized = serverUrl();
		if (!normalized) return;
		if (action !== 'token') {
			displayName = displayName.trim();
			saveDisplayName(displayName);
		}
		switch (action) {
			case 'token':
				signInWithToken(normalized);
				return;
			case 'email-send':
				if (!email.trim()) error = 'Enter your email address.';
				else void sendCode(normalized);
				return;
			case 'email-code':
				void signInWithEmail();
				return;
			case 'sign-out':
				void signOut();
				return;
			case 'done':
				if (displayName && displayName !== snapshot.you?.name) client.setDisplayName(displayName);
				finish();
				return;
			case 'connect':
				connect(normalized);
				return;
		}
	}

	/** The Server field as a `ws:`/`wss:` URL, normalized and remembered; or the error says why it isn't one. */
	function serverUrl(): string | undefined {
		try {
			const normalized = normalizeWebSocketUrl(serverInput, window.location);
			const parsed = new URL(normalized);
			if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') throw new Error('Use a ws:// or wss:// URL');
			serverInput = normalized;
			saveServerUrl(normalized);
			return normalized;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Invalid server URL';
			return undefined;
		}
	}

	/**
	 * A passkey action's tap: the ceremony at once on a connection to the server
	 * in the form (which needs no URL check: the form names it), else a
	 * connection first, and the ceremony once it has settled.
	 */
	function startPasskey(action: 'login' | 'register'): void {
		error = '';
		if (view.phase === 'ready') {
			void passkey(action);
			return;
		}
		const normalized = serverUrl();
		if (!normalized) return;
		displayName = displayName.trim();
		saveDisplayName(displayName);
		connect(normalized, action);
	}

	/** Opens the socket to the server in the form; the effect above carries on once it has settled, with `then` if given. */
	function connect(normalized: string, then?: 'login' | 'register'): void {
		client.setDisplayName(displayName);
		joinedAsGuest = false;
		intent = then;
		// A session held for a sign-in reconnects in place, keeping what the page holds for it.
		if (snapshot.held && normalized === client.url) {
			pending = true;
			client.retryNow();
			return;
		}
		onconnect();
		pending = true;
		if (normalized !== client.url) client.setUrl(normalized);
		else client.restart();
	}

	/**
	 * Reconnects to the server in the field and signs in with the pasted token.
	 * The server names a token's identity (a bot is named after its owner), so
	 * no display name follows as `me`; a sign-up invite takes the display name
	 * with it, to name the account it creates.
	 */
	function signInWithToken(normalized: string): void {
		if (!token.trim()) {
			error = 'Paste a token to sign in with';
			return;
		}
		// Another identity on this backend, or another backend: drop what the page held.
		if (normalized === client.url) onsignout()();
		else onconnect();
		joinedAsGuest = false;
		const name = inviteToken ? displayName.trim() : '';
		if (name) {
			displayName = name;
			saveDisplayName(name);
		}
		client.setDisplayName('');
		if (normalized !== client.url) client.setUrl(normalized);
		client.useToken(token, name || undefined);
		token = '';
		pending = true;
	}

	/**
	 * Asks the server in the field for a code (§4.11). The client proposes
	 * the sign-in on a connection of its own that isn't signed in and keeps it
	 * open for the code, so neither a session here nor a new server's
	 * throwaway guest is involved. The server answers the same whether or not
	 * the address has an account, so this never says which.
	 */
	async function sendCode(url: string): Promise<void> {
		error = '';
		emailBusy = true;
		try {
			const address = email.trim();
			await client.requestEmailCode(address, url);
			codeSent = { email: address, url };
			code = '';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Unable to send a code';
		} finally {
			emailBusy = false;
		}
	}

	/**
	 * Signs in with the emailed code, approved on the connection that asked
	 * for it, which the client then carries on with; the bearer token in the
	 * result is kept to resume with (§3.2). The page lets go of the view it
	 * held only once the code has worked.
	 */
	async function signInWithEmail(): Promise<void> {
		if (!codeSent) return;
		const sent = codeStillFor(codeSent, normalizedInput);
		if (!sent) {
			// Never another server's code: ask this one for its own.
			codeSent = undefined;
			code = '';
			error = 'The server changed since the code was sent. Ask for a new code.';
			return;
		}
		if (!code.trim()) {
			error = 'Enter the code from the email.';
			return;
		}
		error = '';
		emailBusy = true;
		try {
			const switching = sent.url !== client.url;
			await client.signInWithEmail(code, displayName.trim() || undefined, () => (switching ? onconnect() : onsignout()()));
			codeSent = undefined;
			code = '';
			finish();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Unable to sign in';
		} finally {
			emailBusy = false;
		}
	}

	/**
	 * Runs straight from the tap, so the browser sees the user asked for it;
	 * or, `followUp`, right after the connection that tap opened. A browser may
	 * refuse a sheet that long after the tap, as it does one that is dismissed
	 * (`NotAllowedError`): the panel is ready, connected, for another tap.
	 */
	async function passkey(action: 'login' | 'register', followUp = false): Promise<void> {
		error = '';
		notice = '';
		const name = action === 'register' ? displayName.trim() || undefined : undefined;
		// The guest's name, which the connection carries, isn't the account's: it stays as the account has it.
		if (action === 'login') client.setDisplayName('');
		try {
			await client.usePasskey(action, name);
			// What the account is called from here on, for the form and the next visit.
			const kept = name ?? client.snapshot().you?.name;
			if (kept) {
				displayName = kept;
				saveDisplayName(kept);
			}
			finish();
		} catch (cause) {
			// Still the guest it was: it keeps its name.
			if (action === 'login' && displayName.trim()) client.setDisplayName(displayName);
			const refused = cause instanceof DOMException && cause.name === 'NotAllowedError';
			if (followUp && refused) notice = 'Connected. Tap again to continue with your passkey.';
			else error = passkeyMessage(cause);
		}
	}

	async function signOut(): Promise<void> {
		try {
			await signOutThen(client, onsignout);
			pending = true;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Unable to sign out';
		}
	}

	function finish(): void {
		pending = false;
		joinedAsGuest = false;
		onconnected();
	}
</script>

<form class="ap-connect-card" aria-label="Sign in" data-testid="sign-in" data-phase={view.phase} onsubmit={submit}>
	{@render header?.()}
	<div class="ap-fieldlabel">Sign in with
		<div class="ap-seg" role="radiogroup" aria-label="Sign in with">
			{#each schemes as candidate (candidate)}
				<button class="ap-seg-item" class:ap-seg-on={chosen === candidate} type="button" role="radio" aria-checked={chosen === candidate} disabled={busy} onclick={() => (scheme = candidate)}>{LABELS[candidate]}</button>
			{/each}
		</div>
	</div>
	{#if chosen === 'webauthn' && passkeyChoice(use) && !(here && registered)}
		<div class="ap-choice" role="radiogroup" aria-label="Passkey" data-testid="passkey-choice">
			{#each PASSKEY_CHOICES as [value, title, text] (value)}
				<button class="ap-choice-item" class:ap-choice-on={passkeyChosen === value} type="button" role="radio" aria-checked={passkeyChosen === value} data-testid="passkey-choice-{value}" disabled={busy} onclick={() => { passkeyChosen = value; error = ''; notice = ''; }}>
					<span class="ap-choice-title">{title}</span>
					<span class="ap-choice-text">{text}</span>
				</button>
			{/each}
		</div>
	{/if}
	{#if chosen === 'token'}
		<label class="ap-fieldlabel">Token
			<input class="ap-field ap-field-mono" data-testid="connect-token-input" type="password" bind:value={token} placeholder="apron_bot_…" disabled={busy} autocomplete="off" spellcheck="false" />
		</label>
		{#if inviteToken}
			<label class="ap-fieldlabel">Display name
				<input class="ap-field" data-testid="connect-name-input" bind:value={displayName} placeholder="How others see you" disabled={busy} maxlength="64" autocomplete="nickname" spellcheck="false" />
			</label>
		{/if}
	{:else}
		{#if chosen === 'email'}
			<label class="ap-fieldlabel">Email
				<input class="ap-field" data-testid="connect-email-input" type="email" bind:value={email} placeholder="you@example.com" disabled={busy || Boolean(codeSentTo)} autocomplete="email" spellcheck="false" />
			</label>
			{#if codeSentTo}
				<label class="ap-fieldlabel">Code
					<!-- svelte-ignore a11y_autofocus -->
					<input class="ap-field ap-field-mono" data-testid="connect-code-input" bind:value={code} placeholder="From the email" disabled={busy} inputmode="numeric" autocomplete="one-time-code" spellcheck="false" autofocus />
				</label>
			{/if}
		{/if}
		{#if !passkeyLogin}
			<label class="ap-fieldlabel">Display name
				<input class="ap-field" data-testid="connect-name-input" bind:value={displayName} placeholder={chosen === 'webauthn' ? 'Names your account and its passkey' : 'How others see you'} disabled={busy} maxlength="64" autocomplete="nickname" spellcheck="false" />
			</label>
		{/if}
	{/if}
	{#if chosen === 'email' && codeSentTo}
		<p class="ap-profedit-hint" role="status">If {codeSentTo} can sign in here, a code is on its way. Enter it, or open the link in the email.</p>
		<button class="ap-link ap-connect-other" type="button" disabled={busy} onclick={() => { codeSent = undefined; code = ''; error = ''; client.cancelEmailCode(); }}>Use another address, or send a new code</button>
	{:else}
		<p class="ap-profedit-hint" role={view.phase === 'ready' ? 'status' : undefined}>{view.phase === 'ready' && notice ? notice : hint}</p>
	{/if}
	{#if errorText}<p class="ap-profedit-note ap-profedit-err" role="alert">{errorText}</p>{/if}
	<div class="ap-connect-actions">
		{#if busy}<TypingDots />{/if}
		{#if joinedAsGuest && view.phase === 'ready'}
			<button class="ap-btn ap-btn-ghost" type="button" onclick={finish}>Stay a guest</button>
		{:else if canCancel}
			<button class="ap-btn ap-btn-ghost" type="button" onclick={() => { client.cancelPasskeyPrompt(); oncancel(); }}>Cancel</button>
		{/if}
		<button class="ap-btn ap-btn-primary" type="submit" data-testid={view.primary.action} disabled={busy}>{view.primary.label}</button>
	</div>
</form>
