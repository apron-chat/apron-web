<script lang="ts">
	import Settings from '@lucide/svelte/icons/settings';
	import BellOff from '@lucide/svelte/icons/bell-off';
	import { pausedUntilLabel } from '$lib/ui/pause';
	import { isJsonObject } from '$lib/protocol/types';
	import type { ChatClient, OperationHandle } from '$lib/protocol/client';
	import { addEmailError, passkeyMessage, wayBackNudge } from '$lib/ui/connection';
	import { directory } from '$lib/ui/directory.svelte';
	import { prepareAvatar } from '$lib/ui/images';
	import type { SessionView } from '$lib/ui/session.svelte';
	import { saveDisplayName } from '$lib/ui/storage';
	import type { NotificationPermissionState, NotificationTestResult } from '$lib/ui/notifications';
	import type { WebPushPreference } from '$lib/ui/web-push';
	import type { PausedUntil } from '$lib/ui/pause';
	import { presenceLabel } from '$lib/design/components/util';
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
		onsignin: (name?: string, scheme?: 'webauthn' | 'email') => void;
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
	let avatarInput = $state<HTMLInputElement | undefined>();
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
	/** Email sign-in (§4.11), where the server offers it. */
	let canUseEmail = $derived(!!session.server?.auth.includes('email'));
	/**
	 * No way back into the account that the server signs in with, as far as
	 * this browser knows: only a kept token (pasted, or an invite, §3.2), or an
	 * account made with a scheme only in `signup` (§3.1). A gentle nudge to add
	 * a passkey or an email.
	 */
	let wayBack = $derived(snapshot.passkeySession ? wayBackNudge(session.server, snapshot.signInMethods) : undefined);
	/**
	 * Adding an email to this account (§4.11): an explicit action, the code
	 * requested and presented on this signed-in connection. An emailed link
	 * never does this; it signs in.
	 */
	let addEmail = $state<{ step: 'address' | 'code'; email: string; code: string; busy: boolean; error: string } | undefined>();
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
	function signIn(scheme: 'webauthn' | 'email' = 'webauthn'): void {
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
				await client.addEmail(form.code);
				addEmail = undefined;
				passkeyNotice = `Added ${form.email} · sign in with it anywhere`;
				return;
			}
		} catch (cause) {
			form.error = addEmailError(cause);
		}
		form.busy = false;
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
	function save(event: SubmitEvent): void {
		event.preventDefault();
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

<div class="ap-profile">
	{#if open}
		<div class="ap-profile-pop" role="dialog" aria-label="Edit profile">
			<form class="ap-profedit" onsubmit={save}>
				<div class="ap-profedit-top">
					<Avatar name={draft || you?.user_id || '?'} id={you?.user_id} src={avatar} size="lg" status={ownStatus} statusLabel={ownLabel} />
					<div class="ap-profedit-av">
						{#if canUploadAvatar}
							<span class="ap-profedit-avbtns">
								<button class="ap-btn ap-btn-sm" type="button" data-testid="change-avatar" disabled={status === 'saving' || avatarStatus !== 'idle' || !connected} onclick={() => avatarInput?.click()}>
									{avatarStatus === 'uploading' ? 'Uploading…' : you?.avatar ? 'Change avatar' : 'Add avatar'}
								</button>
								{#if you?.avatar}
									<button class="ap-link ap-profedit-remove" type="button" data-testid="remove-avatar" disabled={avatarStatus !== 'idle' || !connected} onclick={removeAvatar}>Remove</button>
								{/if}
							</span>
							<input class="sr" type="file" accept="image/png,image/jpeg,image/gif,image/webp" tabindex="-1" aria-hidden="true" data-testid="avatar-input" bind:this={avatarInput} onchange={(event) => uploadAvatar(event.currentTarget)} />
						{:else if you?.avatar}
							<button class="ap-link ap-profedit-remove" type="button" disabled={avatarStatus !== 'idle' || !connected} onclick={removeAvatar}>Remove avatar</button>
						{:else}
							<span class="ap-profedit-hint">This backend doesn’t take uploads, so your avatar can’t be set here.</span>
						{/if}
						{#if avatarError}<span class="ap-profedit-hint ap-profedit-err" role="alert">{avatarError}</span>{/if}
					</div>
				</div>
				<label class="ap-fieldlabel">Handle
					<input class="ap-field" data-testid="display-name-input" bind:value={draft} disabled={status === 'saving'} maxlength="64" autocomplete="nickname" spellcheck="false" />
				</label>
				<p class="ap-profedit-hint">ID <code>{you?.user_id ?? '—'}</code> · set by the server, can’t be changed</p>
				{#if status === 'altered'}
					<p class="ap-profedit-note" role="status">The server saved your handle as “{serverName}”.</p>
				{:else if status === 'declined'}
					<p class="ap-profedit-note ap-profedit-err" role="alert">
						The server declined this handle{declinedReason ? ` (${declinedReason})` : ''}.
						{#if (canUsePasskey || canUseEmail) && !snapshot.passkeySession}
							Sign in and it’s applied once you’re signed in.
						{:else}
							Your old one is still in use.
						{/if}
					</p>
				{/if}
				{#if canUsePasskey || canUseEmail}
					<div class="ap-profedit-signin" role="group" aria-label="Sign-in">
						<span class="ap-fieldlabel">Sign-in</span>
						{#if snapshot.authBusy && !addEmail?.busy}
							<span class="ap-profedit-hint" role="status"><TypingDots /> {snapshot.passkeyBusy ? 'Confirm on your device…' : 'Signing in…'}</span>
						{:else}
							<span class="ap-profedit-row">
								<span class="signin-actions">
									{#if snapshot.passkeySession}
										<!-- A registered account: a passkey registered or an email code presented here adds to it (§4.10, §4.11). -->
										{#if canUsePasskey && you}
											<button class="ap-btn ap-btn-sm" type="button" data-testid="add-passkey" disabled={!!passkeyUnavailable || !connected || status === 'saving'} onclick={() => passkey('register')}>Add passkey</button>
										{/if}
										{#if canUseEmail && you && !addEmail}
											<button class="ap-btn ap-btn-sm" type="button" data-testid="add-email" disabled={!connected || status === 'saving'} onclick={() => (addEmail = { step: 'address', email: '', code: '', busy: false, error: '' })}>Add email</button>
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
												<button class="ap-btn ap-btn-sm" type="button" data-testid="add-email" title="Keep this identity: add an email address to it, if the server allows" disabled={!connected || status === 'saving'} onclick={() => (addEmail = { step: 'address', email: '', code: '', busy: false, error: '' })}>Add email</button>
											{/if}
										{/if}
									{/if}
								</span>
								{#if passkeyError}
									<span class="ap-profedit-hint ap-profedit-err" role="alert">{passkeyError}</span>
								{:else if passkeyNotice}
									<span class="ap-profedit-hint ap-profedit-ok" role="status">{passkeyNotice}</span>
								{:else if passkeyUnavailable && canUsePasskey && !canUseEmail}
									<span class="ap-profedit-hint">{passkeyUnavailable}</span>
								{:else if wayBack}
									<span class="ap-profedit-hint" data-testid="way-back-nudge">{snapshot.signedInWith === 'token' ? 'Only this browser’s saved session gets you back into this account.' : 'This server doesn’t sign in the way you joined.'} Add {wayBack.length === 2 ? 'a passkey or an email' : wayBack[0] === 'webauthn' ? 'a passkey' : 'an email'} to sign in anywhere.</span>
								{:else}
									<span class="ap-profedit-hint">{snapshot.passkeySession ? (canUseEmail ? 'Signed in' : 'Signed in with a passkey') : 'Signed in as a guest'}</span>
								{/if}
							</span>
							{#if addEmail}
								<span class="add-email" role="group" aria-label="Add email">
									{#if addEmail.step === 'address'}
										<input class="ap-field" type="email" aria-label="Email address to add" placeholder="you@example.com" autocomplete="email" bind:value={addEmail.email} disabled={addEmail.busy} onkeydown={addEmailKeydown} />
										<button class="ap-btn ap-btn-sm" type="button" disabled={addEmail.busy || !addEmail.email.trim()} onclick={continueAddEmail}>Send code</button>
									{:else}
										<input class="ap-field ap-field-mono" aria-label="Code from the email" placeholder="Code" inputmode="numeric" autocomplete="one-time-code" bind:value={addEmail.code} disabled={addEmail.busy} onkeydown={addEmailKeydown} />
										<button class="ap-btn ap-btn-sm" type="button" disabled={addEmail.busy || !addEmail.code.trim()} onclick={continueAddEmail}>Add</button>
									{/if}
									<button class="ap-link" type="button" disabled={addEmail.busy} onclick={() => (addEmail = undefined)}>Cancel</button>
								</span>
								{#if addEmail.error}<span class="ap-profedit-hint ap-profedit-err" role="alert">{addEmail.error}</span>
								{:else if addEmail.step === 'code'}<span class="ap-profedit-hint" role="status">If the server can send to {addEmail.email}, a code is on its way.</span>{/if}
							{/if}
						{/if}
					</div>
				{/if}
				<div class="ap-profedit-actions">
					<button class="ap-btn ap-btn-ghost ap-btn-sm" type="button" disabled={status === 'saving'} onclick={close}>{status === 'altered' ? 'Close' : 'Cancel'}</button>
					<button class="ap-btn ap-btn-primary ap-btn-sm" type="submit" disabled={status === 'saving' || !draft.trim()}>{status === 'saving' ? 'Saving…' : 'Save'}</button>
				</div>
			</form>
		</div>
	{/if}
	<PreferencesDialog
		bind:open={preferencesOpen}
		{notificationsEnabled} {notificationsSupported} {notificationPermission} {notifyScopes}
		{onnotifications} {onnotifyscopes} {ontestnotifications} {webPush} {onwebpush} {oninstallapp} {pause} {onpause} {onresume}
		status={canSetStatus ? { value: you?.status, accepted: session.server?.status ?? [], unsupported, onchoose: chooseStatus, onunsupported: noteUnsupported, disabled: !connected } : undefined}
		onclosed={() => preferencesTrigger?.focus()}
	/>
	<button class="ap-profile-me" class:ap-profile-open={open} type="button" aria-haspopup="dialog" aria-expanded={open} aria-label={`Your profile on ${backendLabel}: ${you?.name || you?.user_id || 'not signed in'}${ownStatus ? `, ${(ownLabel ?? presenceLabel(ownStatus) ?? '').toLowerCase()}` : ''}. Edit`} onclick={toggle}>
		<Avatar name={you?.name || you?.user_id || '?'} id={you?.user_id} src={avatar} status={ownStatus} statusLabel={ownLabel} />
		<span class="ap-profile-text">
			<span class="ap-profile-name">{you?.name || you?.user_id || 'Not signed in'}</span>
			<span class="ap-profile-sub">on {backendLabel}{#if wayBack} · add a sign-in{/if}</span>
		</span>
		<span class="ap-profile-edit" aria-hidden="true">Edit</span>
	</button>
	<button class="ap-profile-settings" bind:this={preferencesTrigger} type="button" aria-label={paused ? `Open preferences. Notifications paused ${paused}` : 'Open preferences'} aria-haspopup="dialog" title={paused ? `Preferences · notifications paused ${paused}` : 'Preferences'} onclick={showPreferences}>
		<Settings size={18} strokeWidth={1.6} aria-hidden="true" />
		{#if paused}<span class="ap-profile-paused" aria-hidden="true"><BellOff size={10} strokeWidth={2.2} /></span>{/if}
	</button>
</div>

<style>
	.ap-profile { display: flex; align-items: center; gap: var(--space-1); }
	.add-email { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-1); }
	.add-email .ap-field { flex: 1; min-width: 0; height: 28px; font-size: 13px; }
	.ap-profile-me { flex: 1; min-width: 0; width: auto; }
	.ap-profile-settings { flex: none; width: 32px; height: 32px; display: grid; place-items: center; padding: 0; color: var(--ink-muted); background: transparent; border: 0; border-radius: var(--radius-md); cursor: pointer; }
	.ap-profile-settings:hover { color: var(--ink); background: var(--bg-300); }
	.ap-profile-settings:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
	.ap-profile-settings { position: relative; }
	/* Notifications paused (§4.5 `mute`): a small bell-off on the gear's corner. */
	.ap-profile-paused { position: absolute; right: 2px; bottom: 2px; display: grid; place-items: center; width: 14px; height: 14px; border-radius: 50%; background: var(--bg-100); color: var(--warn); box-shadow: 0 0 0 1px var(--line); }
	.ap-profile-pop { max-height: calc(100dvh - 96px); overflow-y: auto; }
	.ap-profile-pop .ap-profedit-actions { flex-wrap: wrap; }
	.signin-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
	.signin-actions { align-items: center; }
	.sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
</style>
