<script lang="ts">
	import { tick } from 'svelte';
	import { isJsonObject } from '$lib/protocol/types';
	import type { ChatClient, OperationHandle } from '$lib/protocol/client';
	import { passkeyMessage } from '$lib/ui/connection';
	import { directory } from '$lib/ui/directory.svelte';
	import type { SessionView } from '$lib/ui/session.svelte';
	import { appearanceSettings, sanitizeFontFamily, type ThemeMode } from '$lib/ui/appearance.svelte';
	import { saveDisplayName } from '$lib/ui/storage';
	import type { NotificationPermissionState, NotificationScope, NotificationTestResult } from '$lib/ui/notifications';
	import Avatar from './Avatar.svelte';
	import FontFamilyField from './FontFamilyField.svelte';
	import TypingDots from './TypingDots.svelte';

	type Status = 'idle' | 'saving' | 'altered' | 'declined';
	type LocalFontAccessWindow = Window & { queryLocalFonts?: () => Promise<Array<{ family: string }>> };
	type FontBrowserState = 'idle' | 'loading' | 'ready' | 'unsupported' | 'denied' | 'error' | 'empty';

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
		onsignin: (name?: string) => void;
	}
	let { client, session, backendLabel, displayName = $bindable(), passkeyUnavailable, notificationsEnabled, notificationsSupported, notificationPermission, notificationScope, onnotifications, onnotificationscope, ontestnotifications, onsignout, onsignin }: Props = $props();

	let open = $state(false);
	let preferencesOpen = $state(false);
	let preferencesSection = $state<'notifications' | 'appearance'>('notifications');
	let interfaceFontDraft = $state('');
	let chatFontDraft = $state('');
	let monoFontDraft = $state('');
	let localFontFamilies = $state<string[]>([]);
	let fontBrowserState = $state<FontBrowserState>('idle');
	let fontError = $state('');
	let testNotificationStatus = $state<'idle' | 'sending' | NotificationTestResult>('idle');
	let preferencesDialog = $state<HTMLDialogElement | undefined>();
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
			await client.uploadAvatar(file);
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

	async function sendTestNotification(): Promise<void> {
		testNotificationStatus = 'sending';
		try {
			testNotificationStatus = await ontestnotifications();
		} catch {
			testNotificationStatus = 'error';
		}
	}

	async function showPreferences(): Promise<void> {
		open = false;
		interfaceFontDraft = appearanceSettings.current.interfaceFont;
		chatFontDraft = appearanceSettings.current.chatFont;
		monoFontDraft = appearanceSettings.current.monoFont;
		localFontFamilies = [];
		fontBrowserState = typeof window !== 'undefined' && typeof (window as LocalFontAccessWindow).queryLocalFonts === 'function' ? 'idle' : 'unsupported';
		fontError = '';
		testNotificationStatus = 'idle';
		preferencesOpen = true;
		await tick();
		preferencesDialog?.showModal();
	}

	function setThemeMode(mode: string): void {
		if (mode !== 'system' && mode !== 'light' && mode !== 'dark') return;
		appearanceSettings.update({ ...appearanceSettings.current, mode: mode as ThemeMode });
	}

	function saveFonts(event: SubmitEvent): void {
		event.preventDefault();
		const interfaceFont = sanitizeFontFamily(interfaceFontDraft);
		const chatFont = sanitizeFontFamily(chatFontDraft);
		const monoFont = sanitizeFontFamily(monoFontDraft);
		if ((interfaceFontDraft.trim() && !interfaceFont) || (chatFontDraft.trim() && !chatFont) || (monoFontDraft.trim() && !monoFont)) {
			fontError = 'Enter a font family name using letters, numbers, spaces, hyphens, periods, or underscores.';
			return;
		}
		appearanceSettings.update({ ...appearanceSettings.current, interfaceFont, chatFont, monoFont });
		fontError = '';
	}

	function resetFonts(): void {
		interfaceFontDraft = '';
		chatFontDraft = '';
		monoFontDraft = '';
		fontError = '';
		appearanceSettings.update({ ...appearanceSettings.current, interfaceFont: '', chatFont: '', monoFont: '' });
	}

	/** Called from the font menu’s button so font access has direct user activation. */
	function loadFontsFromUserAction(): void {
		if (fontBrowserState === 'error') fontBrowserState = 'idle';
		if (fontBrowserState === 'idle') void browseLocalFonts();
	}

	async function browseLocalFonts(): Promise<void> {
		if (fontBrowserState !== 'idle') return;
		const queryLocalFonts = (window as LocalFontAccessWindow).queryLocalFonts;
		if (!queryLocalFonts) {
			fontBrowserState = 'unsupported';
			return;
		}
		fontBrowserState = 'loading';
		try {
			const fonts = await queryLocalFonts.call(window);
			const families = fonts.map((font) => sanitizeFontFamily(font.family)).filter((family) => family !== '');
			localFontFamilies = [...new Set(families)].sort((a, b) => a.localeCompare(b));
			fontBrowserState = localFontFamilies.length ? 'ready' : 'empty';
		} catch (cause) {
			fontBrowserState = cause instanceof DOMException && cause.name === 'NotAllowedError' ? 'denied' : 'error';
		}
	}

	function closePreferences(): void {
		if (preferencesDialog?.open) preferencesDialog.close();
		else preferencesOpen = false;
	}

	function preferencesClosed(): void {
		preferencesOpen = false;
		localFontFamilies = [];
		fontBrowserState = 'idle';
		preferencesTrigger?.focus();
	}

	/** A handle the user typed in the editor, as opposed to the one it opened with. */
	function chosenName(): string | undefined {
		const requested = draft.trim();
		return requested && requested !== openedWith.trim() ? requested : undefined;
	}

	/**
	 * Signing in happens on the connect screen, which carries a handle typed
	 * here along so it is applied once the passkey signs in.
	 */
	function signIn(): void {
		const chosen = chosenName();
		close();
		onsignin(chosen);
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
						{#if canUsePasskey && !snapshot.passkeySession}
							Sign in with a passkey and it’s applied once you’re signed in.
						{:else}
							Your old one is still in use.
						{/if}
					</p>
				{/if}
				{#if canUsePasskey}
					<div class="ap-profedit-signin" role="group" aria-label="Sign-in">
						<span class="ap-fieldlabel">Sign-in</span>
						{#if snapshot.authBusy}
							<span class="ap-profedit-hint" role="status"><TypingDots /> Confirm on your device…</span>
						{:else}
							<span class="ap-profedit-row">
								<span class="signin-actions">
									{#if snapshot.passkeySession}
										<button class="ap-btn ap-btn-sm" type="button" disabled={!!passkeyUnavailable || !you || !connected || status === 'saving'} onclick={() => passkey('register')}>Add passkey</button>
										<button class="ap-btn ap-btn-ghost ap-btn-sm" type="button" disabled={!connected || status === 'saving'} onclick={() => passkey('logout')}>Sign out</button>
									{:else}
										<button class="ap-btn ap-btn-sm" type="button" data-testid="profile-signin" disabled={!!passkeyUnavailable || status === 'saving'} onclick={signIn}>Sign in with a passkey</button>
									{/if}
								</span>
								{#if passkeyError}
									<span class="ap-profedit-hint ap-profedit-err" role="alert">{passkeyError}</span>
								{:else if passkeyNotice}
									<span class="ap-profedit-hint ap-profedit-ok" role="status">{passkeyNotice}</span>
								{:else if passkeyUnavailable}
									<span class="ap-profedit-hint">{passkeyUnavailable}</span>
								{:else}
									<span class="ap-profedit-hint">{snapshot.passkeySession ? 'Signed in with a passkey' : 'Signed in as a guest'}</span>
								{/if}
							</span>
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
	{#if preferencesOpen}
		<dialog class="ap-preferences" bind:this={preferencesDialog} aria-labelledby="ap-pref-title" onclose={preferencesClosed}>
			<header class="ap-preferences-head">
				<div><p>SETTINGS</p><h2 id="ap-pref-title">Preferences</h2></div>
				<button class="ap-btn ap-btn-ghost ap-btn-sm" type="button" aria-label="Close preferences" onclick={closePreferences}>×</button>
			</header>
			<div class="ap-preferences-body">
				<nav class="ap-preferences-nav" aria-label="Preference sections">
					<button type="button" aria-current={preferencesSection === 'notifications' ? 'page' : undefined} onclick={() => (preferencesSection = 'notifications')}>Notifications</button>
					<button type="button" aria-current={preferencesSection === 'appearance' ? 'page' : undefined} onclick={() => (preferencesSection = 'appearance')}>Appearance</button>
				</nav>
				{#if preferencesSection === 'notifications'}
					<section class="ap-preferences-content" aria-labelledby="ap-pref-notifications">
						<h3 id="ap-pref-notifications">Notifications</h3>
						<p class="ap-profedit-hint">Choose when Apron can interrupt you.</p>
						<div class="ap-pref-setting">
							<div>
								<strong>Desktop notifications</strong>
								<p class="ap-profedit-hint">Send selected message alerts when Apron is hidden or unfocused.</p>
								{#if notificationPermission === 'denied'}
									<p class="ap-pref-note ap-profedit-err" role="status">Notifications are blocked by your browser. Allow them in this site’s browser settings, then try again.</p>
								{:else if !notificationsSupported}
									<p class="ap-pref-note" role="status">Notifications aren’t available here. Use a supported browser over HTTPS or localhost.</p>
								{:else if notificationsEnabled}
									<p class="ap-pref-note ap-profedit-ok" role="status">On · your selected message types can alert while Apron is inactive.</p>
								{:else if notificationPermission === 'granted'}
									<p class="ap-pref-note" role="status">Permission is allowed, but notifications are off.</p>
								{:else}
									<p class="ap-pref-note" role="status">Turning this on will ask your browser for permission.</p>
								{/if}
							</div>
							<button class="ap-pref-switch" class:active={notificationsEnabled} type="button" role="switch" aria-checked={notificationsEnabled} aria-label="Desktop notifications" disabled={!notificationsEnabled && (!notificationsSupported || notificationPermission === 'denied')} onclick={onnotifications}><span></span></button>
						</div>
						<label class="ap-pref-fieldlabel" for="ap-notification-scope">What to notify you about</label>
						<select id="ap-notification-scope" class="ap-field ap-pref-select" value={notificationScope} onchange={(event) => onnotificationscope(event.currentTarget.value as NotificationScope)}>
							<option value="everything">Everything</option>
							<option value="mentions">Mentions</option>
						</select>
						<p class="ap-pref-help">Applies when Apron is hidden or unfocused.</p>
						<div class="ap-pref-setting ap-pref-test">
							<div>
								<strong>Test notification</strong>
								<p class="ap-profedit-hint">Send a sample message notification to check browser delivery. This won’t turn notifications on.</p>
								{#if testNotificationStatus === 'sent'}
									<p class="ap-pref-note ap-profedit-ok" role="status">Test notification sent. Check your system notification area.</p>
								{:else if testNotificationStatus === 'denied'}
									<p class="ap-pref-note ap-profedit-err" role="status">Permission was denied; allow notifications in your browser’s site settings.</p>
								{:else if testNotificationStatus === 'unsupported'}
									<p class="ap-pref-note" role="status">Notifications aren’t supported in this browser or connection.</p>
								{:else if testNotificationStatus === 'error'}
									<p class="ap-pref-note ap-profedit-err" role="status">The browser couldn’t display the test notification.</p>
								{/if}
							</div>
							<button class="ap-btn ap-btn-ghost ap-btn-sm" type="button" disabled={testNotificationStatus === 'sending' || !notificationsSupported || notificationPermission === 'denied'} onclick={sendTestNotification}>{testNotificationStatus === 'sending' ? 'Sending…' : 'Send test'}</button>
						</div>
					</section>
				{:else}
					<section class="ap-preferences-content" aria-labelledby="ap-pref-appearance">
						<h3 id="ap-pref-appearance">Appearance</h3>
						<p class="ap-profedit-hint">Adjust the theme and reading fonts on this device.</p>
						<div class="ap-pref-setting ap-pref-theme-setting">
							<div>
								<label for="ap-theme-mode">Theme</label>
								<p class="ap-profedit-hint">System follows your operating system’s light or dark preference.</p>
							</div>
							<select id="ap-theme-mode" class="ap-field ap-pref-select" value={appearanceSettings.current.mode} onchange={(event) => setThemeMode(event.currentTarget.value)}>
								<option value="system">System</option>
								<option value="light">Light</option>
								<option value="dark">Dark</option>
							</select>
						</div>
						<div class="ap-pref-setting ap-pref-font-setting">
							<div class="ap-pref-font-heading">
								<strong>Fonts</strong>
								<p class="ap-profedit-hint">Customize the interface, chat, and monospace fonts on this device.</p>
							</div>
							<p class="ap-pref-help ap-font-access-status" id="ap-font-access-status" role="status" aria-live="polite">
								{#if fontBrowserState === 'unsupported'}
									Installed-font suggestions aren’t supported here; type a font name manually.
								{:else if fontBrowserState === 'denied'}
									Font access was denied; allow it in browser site settings or type a font name manually.
								{:else if fontBrowserState === 'error'}
									Couldn’t load installed fonts; you can still type a name manually.
								{:else if fontBrowserState === 'empty'}
									No font families were available to this site.
								{:else if fontBrowserState === 'loading'}
									Loading installed-font suggestions…
								{:else if fontBrowserState === 'ready'}
									Type to filter {localFontFamilies.length} installed font families. Only your chosen names are saved.
								{:else}
									Click Load installed fonts to request permission and filter suggestions. Manual entry always works.
								{/if}
							</p>
							<form class="ap-pref-fonts" onsubmit={saveFonts}>
								<FontFamilyField id="ap-interface-font" label="Interface font" placeholder="System UI stack" hint="Applies to the app interface. Leave blank for the browser’s system UI font." bind:value={interfaceFontDraft} fonts={localFontFamilies} fontState={fontBrowserState} fallback="var(--font-sans)" onloadfonts={loadFontsFromUserAction} />
								<FontFamilyField id="ap-chat-font" label="Chat font" placeholder="Use interface font" hint="Optional font for message text. Leave blank to match the interface." bind:value={chatFontDraft} fonts={localFontFamilies} fontState={fontBrowserState} fallback="var(--font-chat)" onloadfonts={loadFontsFromUserAction} />
								<FontFamilyField id="ap-mono-font" label="Monospace font" placeholder="System monospace" hint="Used for code, embeds, and command text. Leave blank for the system stack." bind:value={monoFontDraft} fonts={localFontFamilies} fontState={fontBrowserState} fallback="var(--font-mono)" onloadfonts={loadFontsFromUserAction} />
								{#if fontError}<p class="ap-pref-note ap-profedit-err" role="alert">{fontError}</p>{/if}
								<div class="ap-pref-font-actions">
									<button class="ap-btn ap-btn-ghost ap-btn-sm" type="button" onclick={resetFonts}>Reset fonts</button>
									<button class="ap-btn ap-btn-primary ap-btn-sm" type="submit">Apply fonts</button>
								</div>
							</form>
						</div>
					</section>
				{/if}
			</div>
		</dialog>
	{/if}
	<button class="ap-profile-me" class:ap-profile-open={open} type="button" aria-haspopup="dialog" aria-expanded={open} aria-label={`Your profile on ${backendLabel}: ${you?.name || you?.user_id || 'not signed in'}. Edit`} onclick={toggle}>
		<Avatar name={you?.name || you?.user_id || '?'} id={you?.user_id} src={avatar} />
		<span class="ap-profile-text">
			<span class="ap-profile-name">{you?.name || you?.user_id || 'Not signed in'}</span>
			<span class="ap-profile-sub">on {backendLabel}</span>
		</span>
		<span class="ap-profile-edit" aria-hidden="true">Edit</span>
	</button>
	<button class="ap-profile-settings" bind:this={preferencesTrigger} type="button" aria-label="Open preferences" aria-haspopup="dialog" title="Preferences" onclick={showPreferences}>
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/><path d="m19.4 15 .1.1-1.6 2.7-.2-.1a1.7 1.7 0 0 0-1.8.1 1.7 1.7 0 0 0-.9 1.5v.2h-3.2v-.2a1.7 1.7 0 0 0-2.7-1.4l-.2.1-1.6-2.7.1-.1a1.7 1.7 0 0 0 0-3l-.1-.1 1.6-2.7.2.1a1.7 1.7 0 0 0 2.7-1.4v-.2h3.2v.2a1.7 1.7 0 0 0 2.7 1.4l.2-.1 1.6 2.7-.1.1a1.7 1.7 0 0 0 0 3Z"/></svg>
	</button>
</div>

<style>
	.ap-profile { display: flex; align-items: center; gap: var(--space-1); }
	.ap-profile-me { flex: 1; min-width: 0; width: auto; }
	.ap-profile-settings { flex: none; width: 32px; height: 32px; display: grid; place-items: center; padding: 0; color: var(--ink-muted); background: transparent; border: 0; border-radius: var(--radius-md); cursor: pointer; }
	.ap-profile-settings:hover { color: var(--ink); background: var(--bg-300); }
	.ap-profile-settings:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
	.ap-profile-settings svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
	.ap-profile-pop { max-height: calc(100dvh - 96px); overflow-y: auto; }
	.ap-profile-pop .ap-profedit-actions { flex-wrap: wrap; }
	.ap-preferences { width: min(760px, calc(100vw - 32px)); height: min(560px, calc(100dvh - 32px)); max-width: none; max-height: none; margin: auto; padding: 0; color: var(--ink); background: var(--bg-100); border: 1px solid var(--line); border-radius: var(--radius-lg); box-shadow: var(--shadow-popover); }
	.ap-preferences::backdrop { background: rgba(5, 5, 12, .68); backdrop-filter: blur(2px); }
	.ap-preferences-head { height: 76px; display: flex; justify-content: space-between; align-items: center; padding: 0 var(--space-6); border-bottom: 1px solid var(--line); }
	.ap-preferences-head p { margin: 0 0 2px; color: var(--ink-muted); font-size: 10px; letter-spacing: .12em; }
	.ap-preferences-head h2 { margin: 0; font-size: 18px; line-height: 24px; }
	.ap-preferences-body { height: calc(100% - 77px); display: grid; grid-template-columns: 190px minmax(0, 1fr); }
	.ap-preferences-nav { padding: var(--space-4) var(--space-2); border-right: 1px solid var(--line); }
	.ap-preferences-nav button { width: 100%; padding: var(--space-2) var(--space-3); color: var(--ink); text-align: left; background: transparent; border: 0; border-radius: var(--radius-sm); cursor: pointer; }
	.ap-preferences-nav button[aria-current="page"] { color: var(--ink); background: var(--bg-300); }
	.ap-preferences-content { padding: var(--space-6); overflow-y: auto; }
	.ap-preferences-content h3 { margin: 0; font-size: 17px; }
	.ap-preferences-content > p { margin: var(--space-1) 0 var(--space-4); }
	.ap-pref-setting { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); padding: var(--space-4) 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
	.ap-pref-setting strong { font-size: 14px; }
	.ap-pref-setting p { max-width: 420px; margin: var(--space-1) 0 0; }
	.ap-pref-theme-setting label { color: var(--ink); font-size: 14px; font-weight: 600; cursor: pointer; }
	.ap-pref-theme-setting select { flex: none; }
	.ap-pref-font-setting { display: block; }
	.ap-pref-theme-setting + .ap-pref-font-setting { border-top: 0; }
	.ap-pref-switch { flex: none; width: 42px; height: 24px; padding: 3px; display: flex; align-items: center; border: 0; border-radius: 999px; background: var(--bg-300); cursor: pointer; transition: background .15s; }
	.ap-pref-switch span { width: 18px; height: 18px; border-radius: 50%; background: var(--ink-muted); transition: transform .15s, background .15s; }
	.ap-pref-switch.active { background: var(--accent-soft); }
	.ap-pref-switch.active span { background: var(--accent); transform: translateX(18px); }
	.ap-pref-switch:disabled { opacity: .5; cursor: not-allowed; }
	.ap-pref-note { margin: var(--space-3) 0; color: var(--ink-muted); font-size: 13px; line-height: 19px; }
	.ap-pref-fieldlabel { display: block; margin: var(--space-4) 0 var(--space-1); color: var(--ink); font-size: 13px; font-weight: 600; }
	.ap-pref-select { width: min(100%, 320px); }
	.ap-pref-help { margin: var(--space-1) 0 0; color: var(--ink-muted); font-size: 12px; line-height: 17px; }
	.ap-font-access-status { margin: var(--space-2) 0 var(--space-1); }
	.ap-pref-fonts { margin-top: var(--space-4); }
	.ap-pref-font-actions { display: flex; justify-content: flex-end; gap: var(--space-2); margin-top: var(--space-4); }
	@media (max-width: 560px) {
		.ap-preferences { height: min(600px, calc(100dvh - 24px)); width: calc(100vw - 24px); }
		.ap-preferences-body { grid-template-columns: 130px minmax(0, 1fr); }
		.ap-preferences-content { padding: var(--space-4); }
	}
	.signin-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
	.signin-actions { align-items: center; }
	.sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
</style>
