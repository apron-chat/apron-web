<script lang="ts" module>
	export type Scheme = 'guest' | 'webauthn' | 'email' | 'token';
</script>

<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { normalizeWebSocketUrl, type ChatClient } from '$lib/protocol/client';
	import { renderMarkdown } from '$lib/protocol/markdown';
	import { offeredSchemes, passkeyMessage, schemeUse } from '$lib/ui/connection';
	import { directory } from '$lib/ui/directory.svelte';
	import { codeStillFor, type SentCode } from '$lib/ui/email-link';
	import { initials } from '$lib/ui/messages';
	import type { SessionView } from '$lib/ui/session.svelte';
	import { saveDisplayName, saveServerUrl, type RecentServer } from '$lib/ui/storage';
	import TypingDots from './TypingDots.svelte';

	const SCHEMES: Record<Scheme, { label: string; hint: string }> = {
		guest: { label: 'Guest', hint: 'No token needed; the server picks a guest identity.' },
		webauthn: { label: 'Passkey', hint: 'Signs in with a passkey on this device, or creates one. Your display name comes along.' },
		email: { label: 'Email', hint: 'We email you a code to sign in with; the link in the email signs you in too.' },
		token: { label: 'Token', hint: 'Signs in with a token the server gave you, such as a bot token from /invite-bot.' }
	};
	/** Every scheme this client can drive, in the order shown when the server's list isn't known yet. */
	const KNOWN_SCHEMES = Object.keys(SCHEMES) as Scheme[];

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
		onsignout: () => void;
	}
	let {
		client, session, serverInput = $bindable(), displayName = $bindable(), passkeyUnavailable, recentServers, canCancel,
		initialScheme, initialEmail, initialError, onconnect, onconnected, oncancel, onsignout
	}: Props = $props();

	// The initial choice follows the request or the current session; the segmented control owns it from then on.
	let scheme = $state<Scheme>(untrack(() => initialScheme ?? (session.snapshot.passkeySession ? 'webauthn' : 'guest')));
	/** Waiting for a connection (and guest auth) to the server in the form. */
	let pending = $state(false);
	/** Connected to a new backend as a guest; the passkey waits for a tap, since browsers may refuse a prompt the user didn't start. */
	let passkeyStep = $state(false);
	let error = $state(untrack(() => initialError ?? ''));
	/** Email sign-in (§4.10): the address, and the code once the server was asked to send one. */
	let email = $state(untrack(() => initialEmail ?? ''));
	let code = $state('');
	/**
	 * The address a code was requested for, and the server that will send it:
	 * the code field shows while it is set, and the code only ever goes back to
	 * the connection that proposed it, on that server (§4.10). Changing the
	 * Server field drops it, and so does that connection closing.
	 */
	let codeSent = $state<SentCode | undefined>();
	let codeSentTo = $derived(codeSent?.email);
	let emailBusy = $state(false);
	/** The pasted token for the Token scheme; cleared once handed to the client. */
	let token = $state('');
	/** A sign-up invite from `/invite`: it creates an account, named as asked, the server picking its user_id from the name. */
	let inviteToken = $derived(token.trim().startsWith('apron_join_'));
	let plan = $state<'immediate' | 'login' | 'register'>('register');
	let snapshot = $derived(session.snapshot);
	let normalizedInput = $derived.by(() => {
		try {
			return normalizeWebSocketUrl(serverInput, window.location);
		} catch {
			return serverInput.trim();
		}
	});
	/** The form names the backend this client is already signed in to, so sign-in can happen in place. */
	let here = $derived(normalizedInput === client.url && snapshot.status === 'connected' && snapshot.authenticated);
	let passkeySession = $derived(!!snapshot.passkeySession);
	let passkeyHint = $derived(!!snapshot.passkeyHint);
	/** `server.welcome` (§3.2), for the server in the field once it has answered: Markdown, sanitized as a message is. */
	let welcome = $derived.by(() => {
		const text = normalizedInput === client.url ? session.server?.welcome : undefined;
		return text ? renderMarkdown(text, directory.resolve, directory.resolveRoom) : '';
	});
	/**
	 * The sign-in schemes the server in the field advertises, in its order,
	 * that this client can drive (passkeys only where the browser has them).
	 * Until that server has answered, every scheme the client knows.
	 */
	let schemes = $derived.by((): Scheme[] => {
		const offered = normalizedInput === client.url && session.server ? offeredSchemes(session.server) : undefined;
		const listed = offered ? offered.filter((candidate): candidate is Scheme => Object.hasOwn(SCHEMES, candidate)) : KNOWN_SCHEMES;
		const usable = listed.filter((candidate) => candidate !== 'webauthn' || !passkeyUnavailable);
		return usable.length ? usable : ['guest'];
	});
	let chosen = $derived(schemes.includes(scheme) ? scheme : schemes[0]);
	/** The server in the field, once it has answered. */
	let known = $derived(normalizedInput === client.url ? session.server : undefined);
	/**
	 * Whether the chosen scheme signs in, creates an account, or both
	 * (`server.signup`, §3.1); unknown servers get both.
	 */
	let use = $derived(known ? schemeUse(known, chosen) : { signIn: true, signUp: true });
	let hint = $derived.by(() => {
		if (chosen === 'webauthn' && !(use.signIn && use.signUp)) {
			return use.signIn ? 'Signs in with a passkey already on your account. New here? Create an account another way first.' : 'Creates an account with a new passkey on this device.';
		}
		if (chosen === 'email' && !(use.signIn && use.signUp)) {
			return use.signIn ? 'Signs in with a code sent to an address already on your account.' : 'Creates an account with a code sent to your email address.';
		}
		if (chosen === 'token' && inviteToken) return 'Creates an account with this sign-up invite. Your user ID is picked from your display name.';
		return SCHEMES[chosen].hint;
	});
	/** The server in the field is the connected one, and its guests only read. */
	let guestReadOnly = $derived(normalizedInput === client.url && session.server?.ext?.demo?.guest_posting === false);
	/** A passkey ceremony can start from this tap: signed in here as a guest. */
	let passkeyNow = $derived(chosen === 'webauthn' && !passkeySession && here);
	let status = $derived.by((): 'idle' | 'connecting' | 'authing' => {
		if (snapshot.authBusy || emailBusy) return 'authing';
		if (!pending) return 'idle';
		if (snapshot.error) return 'idle';
		if (snapshot.status === 'connected') return session.ready ? 'idle' : 'authing';
		if (snapshot.status === 'connecting' || snapshot.status === 'reconnecting') return 'connecting';
		return 'idle';
	});
	let busy = $derived(status !== 'idle');
	let errorText = $derived.by(() => {
		if (error) return error;
		if (!pending || !snapshot.error) return '';
		return snapshot.error === 'WebSocket connection error' ? 'Can’t reach the server. Check the address and try again.' : snapshot.error;
	});
	let submitLabel = $derived(
		status === 'connecting' ? 'Connecting…' : status === 'authing' ? 'Signing in…'
			: passkeyNow ? 'Continue with passkey'
			: chosen === 'token' ? 'Sign in'
			: chosen === 'email' ? (codeSentTo ? 'Sign in' : 'Email me a code')
			: here && chosen === 'guest' && passkeySession ? 'Sign out'
			: here ? 'Done' : 'Connect'
	);

	// A code belongs to the server that sent it: editing the Server field away from it drops the code.
	$effect(() => {
		if (codeSent && codeSent.url !== normalizedInput) untrack(() => {
			codeSent = undefined;
			code = '';
			client.cancelEmailCode();
		});
	});

	// Closing the screen, however it closes, gives up a code still waiting: nothing here could take it any more.
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


	// A new backend signs in as a guest first; a passkey choice then waits for a tap.
	$effect(() => {
		if (!pending || snapshot.authBusy || !session.ready || chosen === 'email') return;
		pending = false;
		if (chosen === 'webauthn' && !snapshot.passkeySession) {
			passkeyStep = true;
			return;
		}
		finish();
	});

	$effect(() => {
		void passkeyHint;
		let current = true;
		void client.passkeyPlan().then((next) => {
			if (current) plan = next;
		});
		return () => (current = false);
	});

	// Existing passkeys are offered in the display name field's autofill whenever a tap could sign in.
	$effect(() => {
		if (!passkeyNow || passkeyUnavailable) return;
		const controller = new AbortController();
		void autofill(controller.signal);
		return () => controller.abort();
	});

	async function autofill(signal: AbortSignal): Promise<void> {
		try {
			const result = await client.passkeyAutofill(signal, () => displayName.trim() || undefined);
			if (result) finish();
		} catch (cause) {
			error = passkeyMessage(cause);
		}
	}

	function submit(event: SubmitEvent): void {
		event.preventDefault();
		error = '';
		let normalized: string;
		try {
			normalized = normalizeWebSocketUrl(serverInput, window.location);
			const parsed = new URL(normalized);
			if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') throw new Error('Use a ws:// or wss:// URL');
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Invalid server URL';
			return;
		}
		serverInput = normalized;
		saveServerUrl(normalized);
		if (chosen === 'token') {
			signInWithToken(normalized);
			return;
		}
		if (chosen === 'email') {
			displayName = displayName.trim();
			saveDisplayName(displayName);
			if (!email.trim()) error = 'Enter your email address.';
			else if (!codeSentTo) void sendCode(normalized);
			else void signInWithEmail();
			return;
		}
		displayName = displayName.trim();
		saveDisplayName(displayName);
		if (passkeyNow) {
			void passkey('continue');
		} else if (here && chosen === 'guest' && passkeySession) {
			void signOut();
		} else if (here) {
			if (displayName && displayName !== snapshot.you?.name) client.setDisplayName(displayName);
			finish();
		} else {
			connect(normalized);
		}
	}

	/** Opens the socket to another backend; the effect above finishes once the server answers. */
	function connect(normalized: string): void {
		client.setDisplayName(displayName);
		onconnect();
		passkeyStep = false;
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
		if (normalized === client.url) onsignout();
		else onconnect();
		passkeyStep = false;
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
	 * Asks the server in the field for a code (§4.10). The client proposes
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
			await client.signInWithEmail(code, displayName.trim() || undefined, () => (switching ? onconnect() : onsignout()));
			codeSent = undefined;
			code = '';
			finish();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Unable to sign in';
		} finally {
			emailBusy = false;
		}
	}

	/** Runs straight from the tap, so the browser sees the user asked for it. */
	async function passkey(action: 'continue' | 'register' | 'login'): Promise<void> {
		error = '';
		const name = displayName.trim() || undefined;
		try {
			// Where passkeys only sign in, or only sign up (`server.signup`), there is one thing to do.
			if (action === 'continue' && !use.signUp) await client.usePasskey('login', name);
			else if (action === 'continue' && !use.signIn) await client.usePasskey('register', name);
			else if (action === 'continue') await client.continueWithPasskey(name);
			else await client.usePasskey(action, name);
			finish();
		} catch (cause) {
			error = passkeyMessage(cause);
		}
	}

	async function signOut(): Promise<void> {
		try {
			onsignout();
			await client.signOut();
			pending = true;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Unable to sign out';
		}
	}

	function finish(): void {
		pending = false;
		passkeyStep = false;
		onconnected();
	}
</script>

<div class="app ap-connect">
	<form class="ap-connect-card" aria-label="Connect to a backend" onsubmit={submit}>
		<h1 class="ap-connect-title">Apron</h1>
		<p class="ap-connect-tag">Connect to a backend</p>
		{#if welcome}<div class="ap-welcome ap-msg-text" data-testid="server-welcome">{@html welcome}</div>{/if}
		<label class="ap-fieldlabel">Server
			<input class="ap-field ap-field-mono" data-testid="server-url-input" type="text" inputmode="url" bind:value={serverInput} placeholder="wss://server.apron.chat/" disabled={busy} autocomplete="url" spellcheck="false" />
		</label>
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
			<label class="ap-fieldlabel">Display name
				<input class="ap-field" data-testid="connect-name-input" bind:value={displayName} placeholder="How others see you" disabled={busy} maxlength="64" autocomplete={chosen === 'webauthn' ? 'username webauthn' : 'nickname'} spellcheck="false" />
			</label>
		{/if}
		<div class="ap-fieldlabel">Sign in with
			<div class="ap-seg" role="radiogroup" aria-label="Sign in with">
				{#each schemes as candidate (candidate)}
					<button class="ap-seg-item" class:ap-seg-on={chosen === candidate} type="button" role="radio" aria-checked={chosen === candidate} disabled={busy} onclick={() => (scheme = candidate)}>{SCHEMES[candidate].label}</button>
				{/each}
			</div>
		</div>
		{#if passkeyStep && passkeyNow}
			<p class="ap-profedit-hint" role="status">Connected as a guest. Continue with a passkey to sign in, or stay a guest.</p>
		{:else if chosen === 'email' && codeSentTo}
			<p class="ap-profedit-hint" role="status">If {codeSentTo} can sign in here, a code is on its way. Enter it, or open the link in the email.</p>
		{:else if here && chosen === 'webauthn' && passkeySession}
			<p class="ap-profedit-hint">Signed in with a passkey. Choose Guest to sign out.</p>
		{:else}
			<p class="ap-profedit-hint">{guestReadOnly && chosen === 'guest' ? 'No token needed, but guests only read here: sign in with a passkey to post.' : hint}</p>
		{/if}
		{#if chosen === 'email' && codeSentTo}
			<button class="ap-link ap-connect-other" type="button" disabled={busy} onclick={() => { codeSent = undefined; code = ''; error = ''; client.cancelEmailCode(); }}>Use another address, or send a new code</button>
		{/if}
		{#if passkeyNow && use.signIn && use.signUp}
			<button class="ap-link ap-connect-other" type="button" data-testid="other-passkey" disabled={busy} onclick={() => passkey(plan === 'login' ? 'register' : 'login')}>
				{plan === 'immediate' ? 'Use a passkey from another device' : plan === 'login' ? 'Create a new passkey' : 'Sign in with an existing passkey'}
			</button>
		{/if}
		{#if errorText}<p class="ap-profedit-note ap-profedit-err" role="alert">{errorText}</p>{/if}
		<div class="ap-connect-actions">
			{#if busy}<TypingDots />{/if}
			{#if passkeyStep && passkeyNow}
				<button class="ap-btn ap-btn-ghost" type="button" onclick={() => { client.cancelPasskeyPrompt(); finish(); }}>Stay a guest</button>
			{:else if canCancel}
				<button class="ap-btn ap-btn-ghost" type="button" onclick={() => { client.cancelPasskeyPrompt(); oncancel(); }}>Cancel</button>
			{/if}
			<button class="ap-btn ap-btn-primary" type="submit" disabled={busy}>{submitLabel}</button>
		</div>
	</form>
	{#if recentServers.length > 0}
		<div class="ap-connect-recent" role="group" aria-label="Recent backends">
			<span class="ap-fieldlabel">Recent</span>
			{#each recentServers as recent (recent.url)}
				<button class="ap-connect-recent-item" type="button" disabled={busy} onclick={() => { serverInput = recent.url; error = ''; }}>
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
	.ap-connect .ap-btn-ghost { border-radius: calc(var(--radius-lg) - var(--space-2)); }
	.ap-connect-other { align-self: flex-start; font-size: 13px; }
</style>
