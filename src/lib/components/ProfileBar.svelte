<script lang="ts">
	import Settings from '@lucide/svelte/icons/settings';
	import { isJsonObject } from '$lib/protocol/types';
	import type { ChatClient, OperationHandle } from '$lib/protocol/client';
	import { addEmailError, passkeyMessage, wayBackNudge } from '$lib/ui/connection';
	import { directory } from '$lib/ui/directory.svelte';
	import { prepareAvatar } from '$lib/ui/images';
	import type { SessionView } from '$lib/ui/session.svelte';
	import { saveDisplayName } from '$lib/ui/storage';
	import type { NotificationPermissionState, NotificationScope, NotificationTestResult } from '$lib/ui/notifications';
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
		notificationScope: NotificationScope;
		onnotifications: () => void;
		onnotificationscope: (scope: NotificationScope) => void;
		ontestnotifications: () => Promise<NotificationTestResult>;
		/** Signing out starts a different session: the page drops what it held from this one. */
		onsignout: () => void;
		/** Sign-in lives on the connect screen; this opens it with the handle typed here. */
		/** Opens the connect screen to sign in with `scheme`, carrying a handle typed here. */
		onsignin: (name?: string, scheme?: 'webauthn' | 'email') => void;
	}
	let { client, session, backendLabel, displayName = $bindable(), passkeyUnavailable, notificationsEnabled, notificationsSupported, notificationPermission, notificationScope, onnotifications, onnotificationscope, ontestnotifications, onsignout, onsignin }: Props = $props();

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
	let avatar = $derived(directory.avatar(you));
	/** Avatars are uploaded with a `/avatar` command (§4.6.6), which needs caps `command` and `embed:upload`. */
	let canUploadAvatar = $derived(session.snapshot.capabilities.command && session.snapshot.capabilities['embed:upload']);
	let snapshot = $derived(session.snapshot);
	let connected = $derived(snapshot.status === 'connected');
	let canUsePasskey = $derived(!!session.server?.auth.includes('webauthn'));
	/** Email sign-in (§4.10), where the server offers it. */
	let canUseEmail = $derived(!!session.server?.auth.includes('email'));
	/**
	 * No way back into the account that the server signs in with, as far as
	 * this browser knows: only a kept token (pasted, or an invite, §3.2), or an
	 * account made with a scheme only in `signup` (§3.1). A gentle nudge to add
	 * a passkey or an email.
	 */
	let wayBack = $derived(snapshot.passkeySession ? wayBackNudge(session.server, snapshot.signInMethods) : undefined);
	/**
	 * Adding an email to this account (§4.10): an explicit action, the code
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
				onsignout();
				await client.signOut();
				passkeyNotice = 'Signed out.';
			} else {
				await client.usePasskey('register');
				passkeyNotice = 'Passkey saved · this backend will ask your device next time';
			}
			resetDraft();
		} catch (cause) {
			passkeyError = passkeyMessage(cause);
		}
	}

	/** The Add email form's next step: ask for a code for the address, then present it here. */
	async function continueAddEmail(): Promise<void> {
		const form = addEmail;
		if (!form || form.busy) return;
		form.error = '';
		form.busy = true;
		try {
			if (form.step === 'address') {
				await client.requestEmailCode(form.email);
				form.step = 'code';
			} else {
				await client.addEmail(form.email, form.code);
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
					<Avatar name={draft || you?.user_id || '?'} id={you?.user_id} src={avatar} size="lg" />
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
										<!-- A registered account: a passkey registered or an email code presented here adds to it (§4.9, §4.10). -->
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
		{notificationsEnabled} {notificationsSupported} {notificationPermission} {notificationScope}
		{onnotifications} {onnotificationscope} {ontestnotifications}
		onclosed={() => preferencesTrigger?.focus()}
	/>
	<button class="ap-profile-me" class:ap-profile-open={open} type="button" aria-haspopup="dialog" aria-expanded={open} aria-label={`Your profile on ${backendLabel}: ${you?.name || you?.user_id || 'not signed in'}. Edit`} onclick={toggle}>
		<Avatar name={you?.name || you?.user_id || '?'} id={you?.user_id} src={avatar} />
		<span class="ap-profile-text">
			<span class="ap-profile-name">{you?.name || you?.user_id || 'Not signed in'}</span>
			<span class="ap-profile-sub">on {backendLabel}{#if wayBack} · add a sign-in{/if}</span>
		</span>
		<span class="ap-profile-edit" aria-hidden="true">Edit</span>
	</button>
	<button class="ap-profile-settings" bind:this={preferencesTrigger} type="button" aria-label="Open preferences" aria-haspopup="dialog" title="Preferences" onclick={showPreferences}>
		<Settings size={18} strokeWidth={1.6} aria-hidden="true" />
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
	.ap-profile-pop { max-height: calc(100dvh - 96px); overflow-y: auto; }
	.ap-profile-pop .ap-profedit-actions { flex-wrap: wrap; }
	.signin-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
	.signin-actions { align-items: center; }
	.sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
</style>
