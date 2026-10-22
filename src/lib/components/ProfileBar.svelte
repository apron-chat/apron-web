<script lang="ts">
	import { pausedUntilLabel } from '$lib/ui/pause';
	import { isJsonObject } from '$lib/protocol/types';
	import type { ChatClient, OperationHandle } from '$lib/protocol/client';
	import { addError, passkeyMessage, wayBackNudge, wayBackWords } from '$lib/ui/connection';
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
	import Avatar from './Avatar.svelte';
	import PreferencesDialog from './PreferencesDialog.svelte';
	import TypingDots from './TypingDots.svelte';

	type Status = 'idle' | 'saving' | 'altered' | 'declined';

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
		/** Sign-in lives on the connect screen; this opens it with the handle typed here. */
		/** Opens the connect screen to sign in with `scheme`, carrying a handle typed here. */
		onsignin: (name?: string, scheme?: 'webauthn' | 'email' | 'external') => void;
	}
	let { client, session, backendLabel, displayName = $bindable(), passkeyUnavailable, notificationsEnabled, notificationsSupported, notificationPermission, notifyScopes, onnotifications, onnotifyscopes, ontestnotifications, webPush, onwebpush, oninstallapp, pause, onpause, onresume, onsignout, onsignin }: Props = $props();

	let open = $state(false);
	let preferencesOpen = $state(false);
	let preferencesTrigger = $state<HTMLButtonElement | undefined>();
	let draft = $state('');
	let status = $state<Status>('idle');
	let serverName = $state('');
	let declinedReason = $state('');
	/** The handle the editor opened with; a different draft is one the user chose. */
	let openedWith = $state('');
	let passkeyError = $state('');
	let passkeyNotice = $state('');
	let avatarStatus = $state<'idle' | 'uploading' | 'removing'>('idle');
	let avatarError = $state('');
	let you = $derived(session.you);
	/** While notifications are paused, when that ends in words ("until 14:30"). */
	let paused = $derived(pause?.until !== undefined ? pausedUntilLabel(pause.until) : undefined);
	let avatar = $derived(directory.avatar(you));
	/** Your `status` as you chose it (§4.5), from `you`: no dot without one. */
	let ownStatus = $derived(typeof you?.status === 'string' && you.status !== '' ? you.status : undefined);
	/** Its tooltip: invisible says how others see you. */
	let ownLabel = $derived(ownStatusLabel(ownStatus));
	/** Choosing a status (§4.5): with capability `status`, signed in. */
	let canSetStatus = $derived(session.snapshot.capabilities.status && session.snapshot.authenticated && you !== undefined);
	/** Optional statuses this server answered something else for anyway (§4.5), per server: not offered again. */
	let unsupportedStatuses = $state<{ server: string; values: string[] }>({ server: '', values: [] });
	let unsupported = $derived(unsupportedStatuses.server === client.url ? unsupportedStatuses.values : []);

	async function chooseStatus(status: string): Promise<string | undefined> {
		const kept = await client.setStatus(status);
		return kept.status;
	}

	function noteUnsupported(status: string): void {
		unsupportedStatuses = { server: client.url, values: [...unsupported.filter((value) => value !== status), status] };
	}
	/** Avatars are uploaded with a `/avatar` command (§4.8.6), which needs capabilities `command` and `embed:upload`. */
	let canUploadAvatar = $derived(session.snapshot.capabilities.command && session.snapshot.capabilities['embed:upload']);
	let snapshot = $derived(session.snapshot);
	let connected = $derived(snapshot.status === 'connected');
	let canUsePasskey = $derived(!!session.server?.auth.includes('webauthn'));
	/** Email sign-in (§4.11.4), where the server offers it. */
	let canUseEmail = $derived(!!session.server?.auth.includes('email'));
	/** External sign-in on the server's page (§4.11.5), where the server offers it. */
	let canUseExternal = $derived(!!session.server?.auth.includes('external'));
	/**
	 * No way back into the account that the server signs in with, as far as
	 * this browser knows: only a kept token (pasted, or an invite, §3.2), or an
	 * account made with a scheme only in `signup` (§3.1). A gentle nudge to add
	 * another way in.
	 */
	let wayBack = $derived(snapshot.passkeySession ? wayBackNudge(session.server, snapshot.signInMethods) : undefined);
	/**
	 * Adding an email, or an external identity, to this account (§4.11.3): an
	 * explicit action, proposed on this signed-in connection, and approved
	 * there with the code (emailed, or shown by the server's page when it
	 * won't return here) or by the link that comes back with this browser's
	 * `state`. A link of no proposal here never adds; it signs in.
	 */
	let addEmail = $state<{ scheme: 'email' | 'external'; step: 'address' | 'code'; email: string; code: string; page?: string; busy: boolean; error: string } | undefined>();
	function toggle(): void {
		if (open) {
			close();
			return;
		}
		draft = you?.name || displayName;
		openedWith = draft;
		status = 'idle';
		serverName = '';
		declinedReason = '';
		passkeyError = '';
		passkeyNotice = '';
		avatarError = '';
		addEmail = undefined;
		open = true;
	}

	/** The server sets `avatar` and sends `user` once the image is written; `you` then carries it. */
	async function uploadAvatar(input: HTMLInputElement): Promise<void> {
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		avatarStatus = 'uploading';
		avatarError = '';
		try {
			// Cropped square, shrunk under the avatar limit, and stripped of metadata.
			const { file: avatar } = await prepareAvatar(file);
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

	function close(): void {
		open = false;
		status = 'idle';
	}

	function showPreferences(): void {
		open = false;
		preferencesOpen = true;
	}

	/** A handle the user typed in the editor, as opposed to the one it opened with. */
	function chosenName(): string | undefined {
		const requested = draft.trim();
		return requested && requested !== openedWith.trim() ? requested : undefined;
	}

	/**
	 * Signing in happens on the connect screen, which carries a handle typed
	 * here along so it is applied once the passkey or email signs in.
	 */
	function signIn(scheme: 'webauthn' | 'email' | 'external' = 'webauthn'): void {
		const chosen = chosenName();
		close();
		onsignin(chosen, scheme);
	}

	/** Account actions for a passkey session: another passkey for this identity, or signing out. */
	async function passkey(action: 'register' | 'logout'): Promise<void> {
		passkeyError = '';
		passkeyNotice = '';
		try {
			if (action === 'logout') {
				await signOutThen(client, onsignout);
				passkeyNotice = 'Signed out.';
			} else {
				// Labelled with the account's name, so the passkey manager shows whose it is.
				await client.usePasskey('register', you?.name);
				passkeyNotice = 'Passkey saved · this backend will ask your device next time';
			}
			resetDraft();
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

	function resetDraft(): void {
		draft = you?.name || displayName;
		openedWith = draft;
		if (status === 'declined') status = 'idle';
	}

	/** Shows what the server kept for a `me` request carrying `requested`. */
	async function track(handle: OperationHandle, requested: string, closeWhenKept: boolean): Promise<void> {
		status = 'saving';
		declinedReason = '';
		try {
			const result = await handle.promise;
			const kept = isJsonObject(result.you) && typeof result.you.name === 'string' ? result.you.name : requested;
			if (kept === requested) {
				if (closeWhenKept) {
					close();
					return;
				}
				status = 'idle';
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

	/** Sends the handle with `name`; the editor then shows what the server actually kept. */
	function save(): void {
		const requested = draft.trim();
		if (!requested) return;
		displayName = requested;
		saveDisplayName(requested);
		const handle = client.setDisplayName(requested);
		if (!handle) {
			close();
			return;
		}
		void track(handle, requested, true);
	}
</script>

<!-- The design system's ProfileBar and ProfileEditor draw it; the app fills in its avatar, and the ways to sign in this server offers. -->
{#snippet barAvatar()}
	<Avatar name={you?.name || you?.user_id || '?'} id={you?.user_id} src={avatar} status={ownStatus} statusLabel={ownLabel} />
{/snippet}
{#snippet face()}
	<Avatar name={draft || you?.user_id || '?'} id={you?.user_id} src={avatar} size="lg" status={ownStatus} statusLabel={ownLabel} />
{/snippet}
{#snippet signin()}
	{#if snapshot.authBusy && !addEmail?.busy}
		<span class="ap-profedit-hint" role="status"><TypingDots /> {snapshot.passkeyBusy ? 'Confirm on your device…' : 'Signing in…'}</span>
	{:else}
		<span class="ap-profedit-row">
			<span class="ap-profedit-buttons">
				{#if snapshot.passkeySession}
					<!-- A registered account: a passkey registered or an email code presented here adds to it (§4.10, §4.11). -->
					{#if canUsePasskey && you}
						<button class="ap-btn ap-btn-sm" type="button" data-testid="add-passkey" disabled={!!passkeyUnavailable || !connected || status === 'saving'} onclick={() => passkey('register')}>Add passkey</button>
					{/if}
					{#if canUseEmail && you && !addEmail}
						<button class="ap-btn ap-btn-sm" type="button" data-testid="add-email" disabled={!connected || status === 'saving'} onclick={() => (addEmail = { scheme: 'email', step: 'address', email: '', code: '', busy: false, error: '' })}>Add email</button>
					{/if}
					{#if canUseExternal && you && !addEmail}
						<button class="ap-btn ap-btn-sm" type="button" data-testid="add-external" disabled={!connected || status === 'saving'} onclick={addExternal}>Add external sign-in</button>
					{/if}
					<button class="ap-btn ap-btn-ghost ap-btn-sm" type="button" disabled={!connected || status === 'saving'} onclick={() => passkey('logout')}>Sign out</button>
				{:else}
					{#if canUsePasskey}
						<button class="ap-btn ap-btn-sm" type="button" data-testid="profile-signin" disabled={!!passkeyUnavailable || status === 'saving'} onclick={() => signIn('webauthn')}>Sign in with a passkey</button>
					{/if}
					{#if canUseEmail}
						<button class="ap-btn ap-btn-sm" type="button" data-testid="profile-signin-email" disabled={status === 'saving'} onclick={() => signIn('email')}>Sign in with email</button>
						<!-- Adding an address to a guest asks and answers on this connection; whether that keeps the
						     guest identity as an account is the server's call (§4.11). -->
						{#if you && !addEmail}
							<button class="ap-btn ap-btn-sm" type="button" data-testid="add-email" title="Keep this identity: add an email address to it, if the server allows" disabled={!connected || status === 'saving'} onclick={() => (addEmail = { scheme: 'email', step: 'address', email: '', code: '', busy: false, error: '' })}>Add email</button>
						{/if}
					{/if}
					{#if canUseExternal}
						<button class="ap-btn ap-btn-sm" type="button" data-testid="profile-signin-external" disabled={status === 'saving'} onclick={() => signIn('external')}>Sign in externally</button>
						{#if you && !addEmail}
							<button class="ap-btn ap-btn-sm" type="button" data-testid="add-external" title="Keep this identity: add an external sign-in to it, if the server allows" disabled={!connected || status === 'saving'} onclick={addExternal}>Add external sign-in</button>
						{/if}
					{/if}
				{/if}
			</span>
			{#if passkeyError}
				<span class="ap-profedit-hint ap-tone-danger" role="alert">{passkeyError}</span>
			{:else if passkeyNotice}
				<span class="ap-profedit-hint ap-tone-ok" role="status">{passkeyNotice}</span>
			{:else if passkeyUnavailable && canUsePasskey && !canUseEmail && !canUseExternal}
				<span class="ap-profedit-hint">{passkeyUnavailable}</span>
			{:else if wayBack}
				<span class="ap-profedit-hint" data-testid="way-back-nudge">{snapshot.signedInWith === 'token' ? 'Only this browser’s saved session gets you back into this account.' : 'This server doesn’t sign in the way you joined.'} Add {wayBackWords(wayBack)} to sign in anywhere.</span>
			{:else}
				<span class="ap-profedit-hint">{snapshot.passkeySession ? (canUseEmail || canUseExternal ? 'Signed in' : 'Signed in with a passkey') : 'Signed in as a guest'}</span>
			{/if}
		</span>
		{#if addEmail}
			<span class="ap-profedit-add" role="group" aria-label={addEmail.scheme === 'email' ? 'Add email' : 'Add external sign-in'}>
				{#if addEmail.scheme === 'external' && !addEmail.page}
					<span class="ap-profedit-hint" role="status"><TypingDots /> Opening the sign-in page…</span>
				{:else if addEmail.step === 'address'}
					<input class="ap-field" type="email" aria-label="Email address to add" placeholder="you@example.com" autocomplete="email" bind:value={addEmail.email} disabled={addEmail.busy} onkeydown={addEmailKeydown} />
					<button class="ap-btn ap-btn-sm" type="button" disabled={addEmail.busy || !addEmail.email.trim()} onclick={continueAddEmail}>Send code</button>
				{:else}
					<input class="ap-field ap-field-mono" aria-label={addEmail.scheme === 'email' ? 'Code from the email' : 'Code from the sign-in page'} placeholder="Code" inputmode={addEmail.scheme === 'email' ? 'numeric' : 'text'} autocomplete="one-time-code" bind:value={addEmail.code} disabled={addEmail.busy} onkeydown={addEmailKeydown} />
					<button class="ap-btn ap-btn-sm" type="button" disabled={addEmail.busy || !addEmail.code.trim()} onclick={continueAddEmail}>Add</button>
				{/if}
				<button class="ap-link" type="button" disabled={addEmail.busy} onclick={() => (addEmail = undefined)}>Cancel</button>
			</span>
			{#if addEmail.error}<span class="ap-profedit-hint ap-tone-danger" role="alert">{addEmail.error}</span>
			{:else if addEmail.scheme === 'external' && addEmail.page}<span class="ap-profedit-hint" role="status"><a href={addEmail.page} target="_blank" rel="noopener noreferrer">Open the sign-in page</a>, sign in there, then enter the code it shows you.</span>
			{:else if addEmail.step === 'code' && addEmail.scheme === 'email'}<span class="ap-profedit-hint" role="status">If the server can send to {addEmail.email}, a code is on its way.</span>{/if}
		{/if}
	{/if}
{/snippet}
{#snippet editor()}
	<ProfileEditor
		dialog={false}
		userId={you?.user_id ?? '—'}
		bind:name={draft}
		avatar={you?.avatar}
		{face}
		canUpload={canUploadAvatar}
		onavatarfile={uploadAvatar}
		onremoveavatar={removeAvatar}
		avatarBusy={avatarStatus === 'idle' ? undefined : avatarStatus}
		{avatarError}
		offline={!connected}
		{status}
		{serverName}
		{declinedReason}
		declinedHint={(canUsePasskey || canUseEmail || canUseExternal) && !snapshot.passkeySession ? 'Sign in and it’s applied once you’re signed in.' : undefined}
		onsave={save}
		oncancel={close}
		signin={canUsePasskey || canUseEmail || canUseExternal ? signin : undefined}
	/>
{/snippet}

<DesignProfileBar
	{you}
	placeholder={session.starting ? 'Signing in…' : 'Not signed in'}
	backend={backendLabel}
	note={wayBack ? 'add a sign-in' : undefined}
	status={ownStatus}
	statusLabel={ownLabel}
	avatar={barAvatar}
	{open}
	onedit={toggle}
	{editor}
	onpreferences={showPreferences}
	{paused}
	bind:preferencesButton={preferencesTrigger}
>
	<PreferencesDialog
		bind:open={preferencesOpen}
		{notificationsEnabled} {notificationsSupported} {notificationPermission} {notifyScopes}
		{onnotifications} {onnotifyscopes} {ontestnotifications} {webPush} {onwebpush} {oninstallapp} {pause} {onpause} {onresume}
		status={canSetStatus ? { value: you?.status, accepted: session.server?.status ?? [], unsupported, onchoose: chooseStatus, onunsupported: noteUnsupported, disabled: !connected } : undefined}
		onclosed={() => preferencesTrigger?.focus()}
	/>
</DesignProfileBar>
