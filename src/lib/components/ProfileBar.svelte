<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { preferencesDialog } from './lazy';
	import { preferencesOpener } from '$lib/ui/preferences.svelte';
	import { pausedUntilLabel } from '$lib/ui/pause';
	import { isJsonObject } from '$lib/protocol/types';
	import { shownPerson } from '$lib/protocol/plain-text';
	import { bioOf, cleanBio, keepsBio, MAX_BIO_CHARS, serverMedia, type ChatClient, type OperationHandle } from '$lib/protocol/client';
	import { addError, passkeyMessage, statusLabel, wayBackNudge, wayBackWords } from '$lib/ui/connection';
	import { returnUrl } from '$lib/ui/sign-in-link';
	import { directory } from '$lib/ui/directory.svelte';
	import { prepareAvatar } from '$lib/ui/images';
	import type { SessionView } from '$lib/ui/session.svelte';
	import { saveDisplayName } from '$lib/ui/storage';
	import type { NotificationPermissionState, NotificationTestResult } from '$lib/ui/notifications';
	import type { WebPushPreference } from '$lib/ui/web-push';
	import type { PausedUntil } from '$lib/ui/pause';
	import DesignProfileBar from '$lib/design/components/ProfileBar.svelte';
	import ProfileEditor from '$lib/design/components/ProfileEditor.svelte';
	import { ownStatusLabel } from '$lib/ui/user-status';
	import { signOutThen, type SignOutHandler } from '$lib/ui/sign-in';
	import Avatar from '$lib/design/components/Avatar.svelte';
	import { hueOf } from '$lib/ui/messages';
	import TypingDots from '$lib/design/components/TypingDots.svelte';
	import { exportArchive } from '$lib/archive/archive';
	import { historySettings } from '$lib/history/settings.svelte';
	import type { KeptHistoryControls } from '$lib/history/history-keeper';

	/** Asked before Sign out deletes this account's history, with Keep local history unchecked. */
	const SIGN_OUT_DELETES_HISTORY = 'Signing out deletes local history. Continue?';

	type Status = 'idle' | 'saving' | 'saved' | 'altered' | 'declined';

	interface Props {
		client: ChatClient;
		session: SessionView;
		backendLabel: string;
		displayName: string;
		passkeyUnavailable?: string;
		notificationsEnabled: boolean;
		notificationsSupported: boolean;
		notificationPermission: NotificationPermissionState;
		/** What to notify about (`NOTIFY_SCOPES`), for desktop notifications and push alike. */
		notifyScopes: string[];
		onnotifications: () => void;
		onnotifyscopes: (scopes: string[]) => void;
		ontestnotifications: () => Promise<NotificationTestResult>;
		/** Push notifications (§4.9), when the server offers web push. */
		webPush?: WebPushPreference;
		onwebpush: () => void;
		/** Chromium's install prompt, from the push setting. */
		oninstallapp: () => void;
		/** Pausing notifications (§4.5 `mute`), on a server with capability `status`. */
		pause?: { until?: PausedUntil };
		onpause: (until: PausedUntil) => Promise<void> | void;
		onresume: () => Promise<void> | void;
		/** Signing out starts a different session: the page drops what it held from this one. */
		onsignout: SignOutHandler;
		/** The history kept on this device: Sign out keeps this account's or deletes it, and Preferences clears it. */
		keptHistory?: KeptHistoryControls;
		/**
		 * Opens the connect screen to sign in, with `scheme` or the way the server offers first, carrying a name typed
		 * here; none where the page has no connect screen (an export read, the preview).
		 */
		onsignin?: (name?: string, scheme?: 'webauthn' | 'email' | 'external') => void;
	}
	let { client, session, backendLabel, displayName = $bindable(), passkeyUnavailable, notificationsEnabled, notificationsSupported, notificationPermission, notifyScopes, onnotifications, onnotifyscopes, ontestnotifications, webPush, onwebpush, oninstallapp, pause, onpause, onresume, onsignout, keptHistory, onsignin }: Props = $props();

	let preferencesOpen = $state(false);
	/** Preferences mounts the first time it opens and then stays, so nothing of it renders or runs on a page that never opens it. */
	let preferencesMounted = $state(false);
	/** The section Preferences shows: Profile from the bar, the one last chosen, or the one asked for (`preferencesOpener`). */
	let preferencesSection = $state('profile');
	let preferencesTrigger = $state<HTMLButtonElement | undefined>();
	let draft = $state('');
	let status = $state<Status>('idle');
	let serverName = $state('');
	let declinedReason = $state('');
	/** The handle the editor opened with; a different draft is one the user chose. */
	let openedWith = $state('');
	let passkeyError = $state('');
	let passkeyNotice = $state('');
	/** Sign out's Keep local history: checked each time, so deleting is always chosen. */
	let keepHistory = $state(true);
	/** History is kept on this device, so Sign out offers to keep this account's or delete it. */
	let offersKeep = $derived(Boolean(keptHistory) && historySettings.retention !== 'off');
	let bioDraft = $state('');
	/** The bio the editor opened with; Save sends the bio only when the draft differs. */
	let bioOpenedWith = $state('');
	let bioError = $state('');
	let avatarStatus = $state<'idle' | 'uploading' | 'removing'>('idle');
	let avatarError = $state('');
	let you = $derived(session.you);
	/** The account whose history Preferences' Clear current user deletes: a session saved here. */
	let keptAccount = $derived(session.passkeySession && you ? { server: client.url, userId: you.user_id } : undefined);
	/** You as the bar shows you: your name without bidi embeddings and overrides (§3.5.2); the editor starts from it as written. */
	let shownYou = $derived(shownPerson(you));
	/** While notifications are paused, when that ends in words ("until 14:30"). */
	let paused = $derived(pause?.until !== undefined ? pausedUntilLabel(pause.until) : undefined);
	let avatar = $derived(directory.avatar(you));
	/** The server's host, as Preferences' Media names it: none for the page's own stand-in (an export read, the preview), never a real site (`.invalid`). */
	let serverHost = $derived(directory.origin && !new URL(directory.origin).hostname.endsWith('.invalid') ? new URL(directory.origin).host : undefined);
	/** You as the bar shows you: your avatar only where avatars may load from. */
	let barYou = $derived(shownYou && { ...shownYou, avatar });
	/** Your `status` as you chose it (§4.5), from `you`: no dot without one. */
	let ownStatus = $derived(typeof you?.status === 'string' && you.status !== '' ? you.status : undefined);
	/** Not connected (connecting, or reconnecting): the dot isn't your status yet, so it says so, quietly. */
	let away = $derived(session.connection !== 'connected');
	/** The dot: your status once connected; until then, a placeholder ring, never online's green. */
	let shownStatus = $derived(ownStatus !== undefined && away ? 'unknown' : ownStatus);
	/** Its tooltip: invisible says how others see you; while not connected, what's happening. */
	let ownLabel = $derived(ownStatus !== undefined && away ? statusLabel(session.snapshot, session.stalled) : ownStatusLabel(ownStatus));
	/** Choosing a status (§4.5): with capability `status`, signed in. */
	let canSetStatus = $derived(session.snapshot.capabilities.status && session.snapshot.authenticated && you !== undefined);
	/** Optional statuses this server answered something else for anyway (§4.5), per server: not offered again. */
	let unsupportedStatuses = $state<{ server: string; values: string[] }>({ server: '', values: [] });
	let unsupported = $derived(unsupportedStatuses.server === client.url ? unsupportedStatuses.values : []);

	/**
	 * Preferences' Export: what the client has stored, saved as a file, unless there is nothing yet. The threads
	 * listed but never opened load their newest messages first, so none of them is saved empty: those in private
	 * rooms only when private rooms go too.
	 */
	async function exportChats(options: { privateRooms: boolean }): Promise<{ name: string; rooms: number; messages: number; privateLeftOut: number } | undefined> {
		const rooms = new Map(client.snapshot().rooms.map((room) => [room.id, room]));
		const inPrivate = (id: string): boolean => {
			for (let at: string | undefined = id, depth = 0; at !== undefined && depth < 64; at = rooms.get(at)?.parentRoomId, depth++) if (rooms.get(at)?.private === true) return true;
			return false;
		};
		const unopened = [...rooms.values()].filter((room) => room.parentRoomId !== undefined && !room.loaded && !room.resumed && (options.privateRooms || !inPrivate(room.id)));
		await Promise.allSettled(unopened.map((room) => client.loadRoom(room.id)));
		const file = exportArchive(client.url, client.snapshot(), client.storedRecords(), client.roomSyncs(), options);
		if (file.rooms === 0) return undefined;
		const url = URL.createObjectURL(new Blob([file.text], { type: 'application/jsonl' }));
		const link = Object.assign(document.createElement('a'), { href: url, download: file.name });
		link.click();
		// Kept a while: a browser may still be reading it after the click returns.
		setTimeout(() => URL.revokeObjectURL(url), 60_000);
		return file;
	}

	async function chooseStatus(status: string): Promise<string | undefined> {
		const kept = await client.setStatus(status);
		return kept.status;
	}

	function noteUnsupported(status: string): void {
		unsupportedStatuses = { server: client.url, values: [...unsupported.filter((value) => value !== status), status] };
	}
	/** A bio (`ext:bio`) is set with `me`, signed in, on a server that keeps one. */
	let canSetBio = $derived(keepsBio(session.server) && session.snapshot.authenticated && you !== undefined);
	/** Avatars are uploaded with a `/avatar` command (§4.8.6), which needs capabilities `command` and `embed:upload`. */
	let canUploadAvatar = $derived(session.snapshot.capabilities.command && session.snapshot.capabilities['embed:upload']);
	let snapshot = $derived(session.snapshot);
	let connected = $derived(snapshot.status === 'connected');
	let canUsePasskey = $derived(!!session.server?.auth.includes('webauthn'));
	/** Email sign-in (§4.11.4), where the server offers it. */
	let canUseEmail = $derived(!!session.server?.auth.includes('email'));
	/** External sign-in on the server's page (§4.11.5), where the server offers it. */
	let canUseExternal = $derived(!!session.server?.auth.includes('external'));
	/** Why the server declined the handle, and what happens to it now: a guest who can sign in gets it applied once signed in. */
	let declinedNote = $derived(`The server declined this name${declinedReason ? ` (${declinedReason})` : ''}. ${(canUsePasskey || canUseEmail || canUseExternal) && !snapshot.passkeySession ? 'Sign in and it’s applied once you’re signed in.' : 'Your old one is still in use.'}`);
	/**
	 * No way back into the account that the server signs in with, as far as
	 * this browser knows: only a kept token (pasted, or an invite, §3.2), or an
	 * account made with a scheme only in `signup` (§3.1). A gentle nudge to add
	 * another way in.
	 */
	let wayBack = $derived(session.passkeySession ? wayBackNudge(session.server, session.signInMethods) : undefined);
	/**
	 * Adding an email, or an external identity, to this account (§4.11.3): an
	 * explicit action, proposed on this signed-in connection, and approved
	 * there with the code (emailed, or shown by the server's page when it
	 * won't return here) or by the link that comes back with this browser's
	 * `state`. A link of no proposal here never adds; it signs in.
	 */
	let addEmail = $state<{ scheme: 'email' | 'external'; step: 'address' | 'code'; email: string; code: string; page?: string; busy: boolean; error: string } | undefined>();
	/** The name or bio differs from what the server keeps: Save and Revert show. */
	let dirty = $derived(draft.trim() !== openedWith.trim() || (canSetBio && bioDraft.trim() !== bioOpenedWith.trim()));
	let savedTimer: ReturnType<typeof setTimeout> | undefined;
	/** A guest's Sign in, which takes focus when Sign out goes. */
	let signInButton = $state<HTMLButtonElement>();
	// "Saved." says so a moment, then goes.
	$effect(() => {
		if (status !== 'saved') return;
		clearTimeout(savedTimer);
		savedTimer = setTimeout(() => {
			if (status === 'saved') status = 'idle';
		}, 2000);
		return () => clearTimeout(savedTimer);
	});

	/** Revert: back to what the server keeps. */
	function revert(): void {
		draft = openedWith;
		bioDraft = bioOpenedWith;
		bioError = '';
		status = 'idle';
		declinedReason = '';
	}

	/** Profile's form starts from what the server keeps: your name and bio, and no note from last time. */
	function resetProfile(): void {
		draft = you?.name || displayName;
		openedWith = draft;
		bioDraft = bioOf(you) ?? '';
		bioOpenedWith = bioDraft;
		bioError = '';
		status = 'idle';
		serverName = '';
		declinedReason = '';
		passkeyError = '';
		passkeyNotice = '';
		avatarError = '';
		addEmail = undefined;
	}

	/** The server sets `avatar` and sends `user` once the image is written; `you` then carries it. */
	async function uploadAvatar(file: File): Promise<void> {
		avatarStatus = 'uploading';
		avatarError = '';
		try {
			// Cropped square, shrunk under the avatar limit (the server's, where it states one), and stripped of metadata.
			const { file: avatar } = await prepareAvatar(file, { limits: serverMedia(session.server).avatar });
			await client.uploadAvatar(avatar);
		} catch (cause) {
			avatarError = cause instanceof Error ? cause.message : 'The avatar could not be uploaded';
		} finally {
			avatarStatus = 'idle';
		}
	}

	async function removeAvatar(): Promise<void> {
		avatarStatus = 'removing';
		avatarError = '';
		try {
			const kept = await client.updateProfile({ avatar: '' });
			if (kept.avatar) avatarError = 'The server kept your previous avatar.';
		} catch (cause) {
			avatarError = cause instanceof Error ? cause.message : 'The avatar could not be removed';
		} finally {
			avatarStatus = 'idle';
		}
	}

	/** The bar's button: Preferences, at your profile. */
	function openProfile(): void {
		preferencesSection = 'profile';
		showPreferences();
	}

	function showPreferences(): void {
		resetProfile();
		preferencesMounted = true;
		preferencesOpen = true;
	}

	// Asked from elsewhere on the page, such as Search's link to History: Preferences opens at that section.
	$effect(() => {
		const asked = preferencesOpener.asked;
		if (!asked) return;
		untrack(() => {
			preferencesOpener.asked = undefined;
			preferencesSection = asked.section;
			showPreferences();
		});
	});

	/** A handle the user typed in the editor, as opposed to the one it opened with. */
	function chosenName(): string | undefined {
		const requested = draft.trim();
		return requested && requested !== openedWith.trim() ? requested : undefined;
	}

	/**
	 * Signing in happens on the connect screen, which carries a handle typed
	 * here along so it is applied once the passkey or email signs in.
	 */
	function signIn(scheme?: 'webauthn' | 'email' | 'external'): void {
		const chosen = chosenName();
		preferencesOpen = false;
		onsignin?.(chosen, scheme);
	}

	/** Account actions for a passkey session: another passkey for this identity, or signing out. */
	async function passkey(action: 'register' | 'logout'): Promise<void> {
		passkeyError = '';
		passkeyNotice = '';
		try {
			if (action === 'logout') {
				const forget = offersKeep && !keepHistory ? keptAccount : undefined;
				if (forget && !confirm(SIGN_OUT_DELETES_HISTORY)) return;
				await signOutThen(client, onsignout);
				// Deleting is its own step, once signing out worked, and only of this account's.
				if (forget) await keptHistory?.clear(forget.server, forget.userId);
				keepHistory = true;
				passkeyNotice = forget ? 'Signed out, and this account’s local history deleted.' : 'Signed out.';
			} else {
				// Labelled with the account's name, so the passkey manager shows whose it is.
				await client.usePasskey('register', you?.name);
				passkeyNotice = 'Passkey saved. This server will ask your device next time.';
			}
			resetDraft();
			if (action === 'logout') {
				// Sign out went with the account: focus goes to the guest's Sign in that took its place.
				await tick();
				signInButton?.focus();
			}
		} catch (cause) {
			passkeyError = passkeyMessage(cause);
		}
	}

	/**
	 * The Add email form's next step: propose adding the address on this
	 * signed-in connection, then approve it with the code on the same one (§4.11).
	 */
	async function continueAddEmail(): Promise<void> {
		const form = addEmail;
		if (!form || form.busy) return;
		form.error = '';
		form.busy = true;
		try {
			if (form.step === 'address') {
				await client.requestEmailCodeToAdd(form.email);
				form.step = 'code';
			} else {
				await client.addWithCode(form.code);
				addEmail = undefined;
				passkeyNotice = form.scheme === 'email' ? `Added ${form.email} · sign in with it anywhere` : 'Added · sign in with it anywhere';
				return;
			}
		} catch (cause) {
			form.error = addError(cause, form.scheme);
		}
		form.busy = false;
	}

	/**
	 * Add external sign-in: propose it on this signed-in connection
	 * (§4.11.5) and open the server's page in place of this one, which comes
	 * back with a link that the page adds with. A server that won't send the
	 * viewer back here shows a code on its page instead, for the form.
	 */
	async function addExternal(): Promise<void> {
		passkeyError = '';
		passkeyNotice = '';
		const form: NonNullable<typeof addEmail> = { scheme: 'external', step: 'code', email: '', code: '', busy: true, error: '' };
		addEmail = form;
		try {
			const { page, returns } = await client.proposeExternalToAdd(returnUrl(window.location));
			if (returns) {
				window.location.assign(page);
				return;
			}
			addEmail = { ...form, page, busy: false };
		} catch (cause) {
			addEmail = undefined;
			passkeyError = addError(cause, 'external');
		}
	}

	/** Enter in the Add email fields continues that form, not the profile's. */
	function addEmailKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		void continueAddEmail();
	}

	/** Whose name and bio the form holds: another identity (signed out, signed in elsewhere) starts it afresh. */
	let formFor: string | undefined;
	$effect(() => {
		const id = you?.user_id;
		untrack(() => {
			if (id === undefined || id === formFor) return;
			const first = formFor === undefined;
			formFor = id;
			if (!first || !dirty) resetDraft();
		});
	});

	/** Back to what the server keeps for whoever this session is now: the name and the bio. */
	function resetDraft(): void {
		draft = you?.name || displayName;
		openedWith = draft;
		bioDraft = bioOf(you) ?? '';
		bioOpenedWith = bioDraft;
		bioError = '';
		if (status === 'declined') status = 'idle';
	}

	/** Shows what the server kept for a `me` request carrying `requested`. */
	async function track(handle: OperationHandle, requested: string): Promise<void> {
		status = 'saving';
		declinedReason = '';
		try {
			const result = await handle.promise;
			const kept = isJsonObject(result.you) && typeof result.you.name === 'string' ? result.you.name : requested;
			if (kept === requested) {
				status = 'saved';
			} else {
				serverName = kept;
				status = 'altered';
				// The client asks for the kept name from now on; so does the next visit.
				displayName = kept;
				saveDisplayName(kept);
			}
			draft = kept;
			openedWith = kept;
		} catch (cause) {
			declinedReason = cause instanceof Error ? cause.message : '';
			status = 'declined';
		}
	}

	/**
	 * Sends a changed bio as `me` `{ext: {bio}}`, `""` clearing it (`ext:bio`).
	 * Returns whether the handle should follow: not when the server refused
	 * the bio, which then says why and keeps the editor open.
	 */
	async function saveBio(): Promise<boolean> {
		// Plain text without control or bidi formatting characters, as every client shows it.
		const bio = cleanBio(bioDraft);
		if (!canSetBio || bio === bioOpenedWith) return true;
		status = 'saving';
		bioError = '';
		try {
			const kept = await client.updateProfile({ ext: { bio } });
			bioDraft = bioOf(kept) ?? '';
			bioOpenedWith = bioDraft;
			return true;
		} catch (cause) {
			// `too_large` (§1.1): the server's limit on `ext` is in bytes, which non-Latin text and emoji fill sooner.
			bioError = (cause as { code?: number }).code === -32003 ? 'Your bio is too long for this server. Try a shorter one.' : cause instanceof Error ? cause.message : 'The server didn’t keep your bio';
			status = 'idle';
			return false;
		}
	}

	/** Sends the bio, if it changed, then the handle with `name`; the editor then shows what the server actually kept. */
	async function save(): Promise<void> {
		const requested = draft.trim();
		// Enter in the name with nothing changed submits too: nothing to send.
		if (!requested || !dirty) return;
		if (!(await saveBio())) return;
		displayName = requested;
		saveDisplayName(requested);
		const handle = client.setDisplayName(requested);
		if (!handle) {
			// Not signed in yet: the name goes with the next `auth`, so it is what the form starts from now.
			draft = requested;
			openedWith = requested;
			status = 'saved';
			return;
		}
		void track(handle, requested);
	}
</script>

<!-- The design system's ProfileBar and, in Preferences' Profile, ProfileEditor draw it; the app fills in its avatar, and the ways to sign in this server offers. -->
{#snippet barAvatar()}
	<Avatar name={shownYou?.name || you?.user_id || '?'} hue={hueOf(you?.user_id)} src={avatar} status={shownStatus} statusLabel={ownLabel} />
{/snippet}
{#snippet face()}
	<!-- No status dot: the status is chosen just above it. -->
	<Avatar name={draft || you?.user_id || '?'} hue={hueOf(you?.user_id)} src={avatar} size="lg" />
{/snippet}
{#snippet signinHint()}
	{#if passkeyError}
		<span class="ap-form-hint ap-tone-danger" role="alert">{passkeyError}</span>
	{:else if passkeyNotice}
		<span class="ap-form-hint ap-tone-ok" role="status">{passkeyNotice}</span>
	{:else if passkeyUnavailable && canUsePasskey && !canUseEmail && !canUseExternal}
		<span class="ap-form-hint">{passkeyUnavailable}</span>
	{:else if wayBack}
		<span class="ap-form-hint">{session.signedInWith === 'token' ? 'Only this browser’s saved session gets you back into this account.' : 'This server doesn’t sign in the way you joined.'} Add {wayBackWords(wayBack)} to sign in anywhere.</span>
	{:else if session.passkeySession}
		<span class="ap-form-hint">{canUseEmail || canUseExternal ? 'You can sign in to this account anywhere.' : 'You sign in to this account with a passkey.'}</span>
	{:else}
		<span class="ap-form-hint">You’re a guest here. Sign in to keep your name and rooms.</span>
	{/if}
{/snippet}
{#snippet signin()}
	{#if snapshot.authBusy && !addEmail?.busy}
		<span class="ap-form-hint" role="status"><TypingDots /> {snapshot.passkeyBusy ? 'Confirm on your device…' : 'Signing in…'}</span>
	{:else}
		<!-- How this session signs in comes first, then what you can do about it. -->
		{#if session.passkeySession}
			{@render signinHint()}
			<!-- A registered account: a passkey registered or an email code presented here adds to it (§4.10, §4.11). -->
			<span class="ap-profedit-buttons">
				{#if canUsePasskey && you}
					<button class="ap-btn ap-btn-sm" type="button" disabled={!!passkeyUnavailable || !connected || status === 'saving'} onclick={() => passkey('register')}>Add passkey</button>
				{/if}
				{#if canUseEmail && you && !addEmail}
					<button class="ap-btn ap-btn-sm" type="button" disabled={!connected || status === 'saving'} onclick={() => (addEmail = { scheme: 'email', step: 'address', email: '', code: '', busy: false, error: '' })}>Add email</button>
				{/if}
				{#if canUseExternal && you && !addEmail}
					<button class="ap-btn ap-btn-sm" type="button" disabled={!connected || status === 'saving'} onclick={addExternal}>Add external sign-in</button>
				{/if}
			</span>
		{:else}
			<!-- A guest: signing in, as the composer offers it where guests can't post, at the row's end; the connect screen picks the way. -->
			<span class="ap-profedit-inline">
				{@render signinHint()}
				<button class="ap-btn ap-btn-primary ap-btn-sm" type="button" bind:this={signInButton} disabled={status === 'saving'} onclick={() => signIn()}>Sign in</button>
			</span>
		{/if}
		{#if addEmail}
			<span class="ap-profedit-add" role="group" aria-label={addEmail.scheme === 'email' ? 'Add email' : 'Add external sign-in'}>
				{#if addEmail.scheme === 'external' && !addEmail.page}
					<span class="ap-form-hint" role="status"><TypingDots /> Opening the sign-in page…</span>
				{:else if addEmail.step === 'address'}
					<input class="ap-field" type="email" aria-label="Email address to add" placeholder="you@example.com" autocomplete="email" bind:value={addEmail.email} disabled={addEmail.busy} onkeydown={addEmailKeydown} />
					<button class="ap-btn ap-btn-sm" type="button" disabled={addEmail.busy || !addEmail.email.trim()} onclick={continueAddEmail}>Send code</button>
				{:else}
					<input class="ap-field ap-field-mono" aria-label={addEmail.scheme === 'email' ? 'Code from the email' : 'Code from the sign-in page'} placeholder="Code" inputmode={addEmail.scheme === 'email' ? 'numeric' : 'text'} autocomplete="one-time-code" bind:value={addEmail.code} disabled={addEmail.busy} onkeydown={addEmailKeydown} />
					<button class="ap-btn ap-btn-sm" type="button" disabled={addEmail.busy || !addEmail.code.trim()} onclick={continueAddEmail}>Add</button>
				{/if}
				<button class="ap-link" type="button" disabled={addEmail.busy} onclick={() => (addEmail = undefined)}>Cancel</button>
			</span>
			{#if addEmail.error}<span class="ap-form-hint ap-tone-danger" role="alert">{addEmail.error}</span>
			{:else if addEmail.scheme === 'external' && addEmail.page}<span class="ap-form-hint" role="status"><a href={addEmail.page} target="_blank" rel="noopener noreferrer">Open the sign-in page</a>, sign in there, then enter the code it shows you.</span>
			{:else if addEmail.step === 'code' && addEmail.scheme === 'email'}<span class="ap-form-hint" role="status">If the server can send to {addEmail.email}, a code is on its way.</span>{/if}
		{/if}
	{/if}
{/snippet}
{#snippet signout()}
	<p class="ap-form-hint">Signed in to <bdi>{backendLabel}</bdi> as <bdi>{shownYou?.name || you?.user_id}</bdi>.</p>
	<span class="ap-profedit-signout-actions">
		{#if offersKeep}<label class="ap-pref-check"><input class="ap-checklist-box" type="checkbox" bind:checked={keepHistory} data-testid="keep-history" /> Keep local history</label>{/if}
		<button class="ap-btn ap-btn-sm" type="button" disabled={!connected || status === 'saving'} onclick={() => passkey('logout')}>Sign out</button>
	</span>
{/snippet}
{#snippet profileForm()}
	<ProfileEditor
		dialog={false}
		userId={you?.user_id ?? '—'}
		bind:name={draft}
		bind:bio={bioDraft}
		maxBio={canSetBio ? MAX_BIO_CHARS : undefined}
		{bioError}
		{avatar}
		hasAvatar={Boolean(you?.avatar)}
		{face}
		canUpload={canUploadAvatar}
		onavatarfile={uploadAvatar}
		onremoveavatar={removeAvatar}
		avatarBusy={avatarStatus === 'idle' ? undefined : avatarStatus}
		{avatarError}
		offline={!connected}
		{status}
		{serverName}
		{declinedNote}
		onsave={save}
		{dirty}
		onrevert={revert}
		signin={session.passkeySession ? (canUsePasskey || canUseEmail || canUseExternal ? signin : undefined) : onsignin ? signin : undefined}
		signout={session.passkeySession && you ? signout : undefined}
		changeAvatarTestid="change-avatar" removeAvatarTestid="remove-avatar" avatarFileTestid="avatar-input" nameTestid="display-name-input" bioTestid="bio-input"
	/>
{/snippet}

<DesignProfileBar
	you={barYou}
	placeholder={session.starting ? 'Signing in…' : 'Not signed in'}
	backend={backendLabel}
	note={wayBack ? 'add a sign-in' : undefined}
	status={ownStatus}
	statusLabel={ownLabel}
	avatar={barAvatar}
	open={preferencesOpen}
	onopen={openProfile}
	{paused}
	bind:button={preferencesTrigger}
>
	{#if preferencesMounted && preferencesDialog.component}
		{@const PreferencesDialog = preferencesDialog.component}
		<PreferencesDialog
			bind:open={preferencesOpen}
			bind:section={preferencesSection}
			profile={profileForm}
			{notificationsEnabled} {notificationsSupported} {notificationPermission} {notifyScopes}
			{onnotifications} {onnotifyscopes} {ontestnotifications} {webPush} {onwebpush} {oninstallapp} {pause} {onpause} {onresume}
			status={canSetStatus ? { value: you?.status, accepted: session.server?.status ?? [], unsupported, onchoose: chooseStatus, onunsupported: noteUnsupported, disabled: !connected } : undefined}
			onexport={exportChats}
			{keptHistory}
			{keptAccount}
			mediaHosts={serverMedia(session.server).origins.map((origin) => new URL(origin).host)}
			serverHost={serverHost}
			onclosed={() => preferencesTrigger?.focus()}
		/>
	{/if}
</DesignProfileBar>
