<script lang="ts">
	/**
	 * The one sign-in panel: picks a scheme the server offers, connects to the
	 * server in `serverInput` when it isn't the connected one, and runs one
	 * explicit action per tap (see `$lib/ui/sign-in`). Every way into signing
	 * in (the connect screen, the profile, the read-only bar, a session held
	 * for a sign-in) lands here, so there is one flow to keep right.
	 */
	import { onDestroy, untrack, type Snippet } from 'svelte';
	import { normalizeWebSocketUrl, type ChatClient } from '$lib/protocol/client';
	import { offeredSchemes, passkeyMessage, schemeUse } from '$lib/ui/connection';
	import { codeStillFor, returnUrl, type SentCode } from '$lib/ui/sign-in-link';
	import type { SessionView } from '$lib/ui/session.svelte';
	import { passkeyChoice, passkeyMode, signInHint, signInView, signOutThen, type PasskeyMode, type SignOutHandler, type Scheme } from '$lib/ui/sign-in';
	import { saveDisplayName, saveServerUrl } from '$lib/ui/storage';
	import SignInForm from '$lib/design/components/SignInForm.svelte';

	/** Every scheme this client can drive, in the order shown when the server's list isn't known yet. */
	const KNOWN_SCHEMES: Scheme[] = ['guest', 'webauthn', 'email', 'external', 'token'];

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
		/** Prefills the email field. */
		initialEmail?: string;
		/** Shows an error to start with, e.g. why a sign-in link failed. */
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
		initialScheme, initialEmail, initialError, header, onconnect, onconnected, oncancel, onsignout
	}: Props = $props();

	// The initial choice follows the request or the current session; the segmented control owns it from then on.
	let scheme = $state<Scheme>(untrack(() => initialScheme ?? (session.snapshot.passkeySession ? 'webauthn' : 'guest')));
	/** On Passkey, Sign in or Create account: the viewer picks, the panel never guesses. */
	let passkeyChosen = $state<PasskeyMode>('login');
	/** Waiting for the connection this panel opened to the server in the form. */
	let pending = $state(false);
	/** That connection signed in as a guest, which the passkey step can leave as it is. */
	let joinedAsGuest = $state(false);
	/** The passkey action a tap asked for before there was a connection for it: it runs once there is. */
	let intent = $state<'login' | 'register' | undefined>();
	let error = $state(untrack(() => initialError ?? ''));
	/** What to do next, in place of the hint: the browser refused a sheet that followed a connection. */
	let notice = $state('');
	/** Email sign-in (§4.11.4): the address, and the code once the server was asked to send one. */
	let email = $state(untrack(() => initialEmail ?? ''));
	let code = $state('');
	/**
	 * The code asked for, emailed to an address or shown by an external
	 * sign-in page, and the server that will take it: the code field shows
	 * while it is set, and the code only ever goes back to the connection that
	 * proposed it, on that server (§4.11.2). Changing the Server field drops
	 * it, and so does that connection closing.
	 */
	let codeSent = $state<SentCode | undefined>();
	/** A proposal or a code is under way, or an external sign-in page is opening in place of this one. */
	let codeBusy = $state(false);
	/** The pasted token for the Token scheme; cleared once handed to the client. */
	let token = $state('');
	/**
	 * The name typed under the Token scheme, empty unless the user fills it:
	 * sent with the token for an invite to name the account it creates
	 * (Appendix B.3), and never otherwise, since a name renames any account.
	 */
	let tokenName = $state('');
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
		const listed = offered ? offered.filter((candidate): candidate is Scheme => (KNOWN_SCHEMES as string[]).includes(candidate)) : KNOWN_SCHEMES;
		const usable = listed.filter((candidate) => candidate !== 'webauthn' || !passkeyUnavailable);
		return usable.length ? usable : ['guest'];
	});
	let chosen = $derived(schemes.includes(scheme) ? scheme : schemes[0]);
	/** The code asked for with the chosen scheme, while its field shows. */
	let codeSentTo = $derived(codeSent && codeSent.scheme === chosen ? codeSent : undefined);
	/** The server in the field, once it has answered. */
	let known = $derived(sameServer ? session.server : undefined);
	/** Whether the chosen scheme signs in, creates an account, or both (`server.signup`, §3.1); unknown servers get both. */
	let use = $derived(known ? schemeUse(known, chosen) : { signIn: true, signUp: true });
	/** Signed in here as a guest who only reads (`ext:permissions` with `write: false`). */
	let guestReadOnly = $derived(here && !registered && Boolean(snapshot.readOnly));
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
		busy: Boolean(snapshot.authBusy) || codeBusy,
		codeSent: Boolean(codeSentTo)
	}));
	/**
	 * Signing in with a passkey restores an account, name and all: the form
	 * asks no display name for it, and none is applied to that account.
	 */
	let passkeyLogin = $derived(chosen === 'webauthn' && mode === 'login' && !(here && registered));
	let hint = $derived(signInHint({ scheme: chosen, use, passkey: passkeyChosen, registered, phase: view.phase, here, guest: here && !registered, guestReadOnly }));
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
			client.cancelSignInCode();
		});
	});

	// Closing the panel, however it closes, gives up a code still waiting: nothing here could take it any more.
	onDestroy(() => client.cancelSignInCode());

	// A short code works only on the connection that asked for it (§4.11.2): once that closes (expired, dropped),
	// there is nowhere to type it. The proposal outlives the connection, so an emailed link still works.
	$effect(() => {
		if (!codeSent || codeBusy || snapshot.signInCode) return;
		untrack(() => {
			const emailed = codeSent?.scheme === 'email';
			codeSent = undefined;
			code = '';
			error = emailed
				? 'The connection that asked for that code has closed (it expired, or dropped), so the code can’t be typed here now. The link in the email may still work, or send a new code.'
				: 'The connection that asked for that code has closed (it expired, or dropped). Start again to get a new code.';
		});
	});

	// The connection this panel opened has settled. The passkey action that opened it runs now; without
	// one, a passkey waits for a tap. Everything else is done once signed in.
	$effect(() => {
		if (!pending || chosen === 'email' || chosen === 'external') return;
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
			case 'external-code':
				void signInWithCode();
				return;
			case 'external-start':
				void startExternal(normalized);
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
	 * no display name follows as `me`; a name typed for an invite goes with the
	 * token, to name the account it creates.
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
		const name = tokenName.trim();
		tokenName = '';
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
		codeBusy = true;
		try {
			const address = email.trim();
			await client.requestEmailCode(address, url);
			codeSent = { scheme: 'email', email: address, url };
			code = '';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Unable to send a code';
		} finally {
			codeBusy = false;
		}
	}

	/**
	 * Proposes an external sign-in to the server in the field (§4.11.5), on a
	 * connection of its own as `sendCode` does, and opens the server's page.
	 * It brings the viewer back to this app with a link, which the page signs
	 * in with on its return; so the page is opened in place of this one. A
	 * server that won't send the viewer back here shows a code on its page
	 * instead: the page is offered as a link to open in a new tab, and the
	 * code field shows.
	 */
	async function startExternal(url: string): Promise<void> {
		error = '';
		codeBusy = true;
		let leaving = false;
		try {
			const { page, returns } = await client.proposeExternal(returnUrl(window.location), url);
			if (returns) {
				leaving = true;
				window.location.assign(page);
				return;
			}
			codeSent = { scheme: 'external', page, url };
			code = '';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Unable to start signing in';
		} finally {
			// Busy until the page is replaced.
			if (!leaving) codeBusy = false;
		}
	}

	/**
	 * Signs in with the code (emailed, or shown by the sign-in page), approved
	 * on the connection that asked for it, which the client then carries on
	 * with; the bearer token in the result is kept to resume with (§3.2.1).
	 * The page lets go of the view it held only once the code has worked.
	 */
	async function signInWithCode(): Promise<void> {
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
			error = sent.scheme === 'email' ? 'Enter the code from the email.' : 'Enter the code from the sign-in page.';
			return;
		}
		error = '';
		codeBusy = true;
		try {
			const switching = sent.url !== client.url;
			await client.signInWithCode(code, displayName.trim() || undefined, () => (switching ? onconnect() : onsignout()()));
			codeSent = undefined;
			code = '';
			finish();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Unable to sign in';
		} finally {
			codeBusy = false;
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

<!-- The design system's SignInForm draws the panel; this runs it. -->
<SignInForm
	label="Sign in" phase={view.phase} onsubmit={submit}
	{header} {schemes} scheme={chosen} onscheme={(candidate) => (scheme = candidate as Scheme)}
	passkeyChoice={chosen === 'webauthn' && passkeyChoice(use) && !(here && registered)} passkeyMode={passkeyChosen} onpasskeymode={(value) => { passkeyChosen = value; error = ''; notice = ''; }}
	bind:token bind:email bind:code bind:name={() => (chosen === 'token' ? tokenName : displayName), (value) => (chosen === 'token' ? (tokenName = value) : (displayName = value))} askName={!passkeyLogin}
	sent={codeSentTo} onrestart={() => { codeSent = undefined; code = ''; error = ''; client.cancelSignInCode(); }}
	hint={view.phase === 'ready' && notice ? notice : hint} hintStatus={view.phase === 'ready'} error={errorText} {busy}
	submit={view.primary.label} submitTestid={view.primary.action}
	tokenTestid="connect-token-input" emailTestid="connect-email-input" codeTestid="connect-code-input" nameTestid="connect-name-input" passkeyChoiceTestid="passkey-choice" pageLinkTestid="external-page-link"
	secondary={joinedAsGuest && view.phase === 'ready' ? { label: 'Stay a guest', onclick: finish } : canCancel ? { label: 'Cancel', onclick: () => { client.cancelPasskeyPrompt(); oncancel(); } } : undefined}
/>
