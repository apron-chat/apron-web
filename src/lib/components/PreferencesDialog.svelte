<script lang="ts">
	import { untrack } from 'svelte';
	import { appearanceSettings, sanitizeFontFamily, type FontBrowserState, type ThemeMode } from '$lib/ui/appearance.svelte';
	import type { NotificationPermissionState, NotificationTestResult } from '$lib/ui/notifications';
	import Button from '$lib/design/components/Button.svelte';
	import Callout from '$lib/design/components/Callout.svelte';
	import CheckList from '$lib/design/components/CheckList.svelte';
	import Dialog from '$lib/design/components/Dialog.svelte';
	import SettingRow from '$lib/design/components/SettingRow.svelte';
	import SettingsSections from '$lib/design/components/SettingsSections.svelte';
	import Switch from '$lib/design/components/Switch.svelte';
	import { pausedUntilLabel, type PausedUntil } from '$lib/ui/pause';
	import PauseNotifications from './PauseNotifications.svelte';
	import StatusPicker from './StatusPicker.svelte';
	import { NOTIFY_SCOPES, notifyScopeNotes, pushWake } from '$lib/ui/notify-scopes';
	import type { WebPushPreference } from '$lib/ui/web-push';
	import FontFamilyField from './FontFamilyField.svelte';
	import type { DeviceToken } from '$lib/protocol/client';

	type LocalFontAccessWindow = Window & { queryLocalFonts?: () => Promise<Array<{ family: string }>> };

	interface Props {
		open?: boolean;
		/** Notifications on this device: the one switch, for while Apron is open and, by push, while it's closed. */
		notificationsEnabled: boolean;
		notificationsSupported: boolean;
		notificationPermission: NotificationPermissionState;
		/** What to notify about (`NOTIFY_SCOPES`), open or closed alike. */
		notifyScopes: string[];
		onnotifications: () => void;
		onnotifyscopes: (scopes: string[]) => void;
		ontestnotifications: () => Promise<NotificationTestResult>;
		/** Push (§4.9), when the server offers web push: how far notifications reach while Apron is closed. */
		webPush?: WebPushPreference;
		/** While notifications are on, turns on push here too, or moves it here from another server. */
		onwebpush: () => void;
		/** Pausing notifications (§4.5 `mute`), on a server with capability `status`: `until` while paused. */
		pause?: { until?: PausedUntil };
		onpause: (until: PausedUntil) => Promise<void> | void;
		onresume: () => Promise<void> | void;
		/** Chromium's install prompt, from the push setting. */
		oninstallapp: () => void;
		/**
		 * Choosing your `status` (§4.5), on a server with capability `status`:
		 * `value` as `you` shows it, and the optional ones this server answered
		 * something else for.
		 */
		status?: { value?: string; accepted?: readonly string[]; unsupported: readonly string[]; onchoose: (status: string) => Promise<string | undefined>; onunsupported: (status: string) => void; disabled?: boolean };
		/**
		 * Signing in an app with a token from here (`ext:device_add`), while
		 * signed in to an account on a server that offers it.
		 */
		devices?: { onadd: () => Promise<DeviceToken> };
		onclosed?: () => void;
	}

	let { open = $bindable(false), notificationsEnabled, notificationsSupported, notificationPermission, notifyScopes, onnotifications, onnotifyscopes, ontestnotifications, webPush, onwebpush, oninstallapp, pause, onpause, onresume, status, devices, onclosed }: Props = $props();

	let sections = $derived([
		{ value: 'notifications', label: 'Notifications', hint: 'Choose when Apron can interrupt you.', id: 'ap-pref-notifications' },
		{ value: 'appearance', label: 'Appearance', hint: 'Adjust the theme and reading fonts on this device.', id: 'ap-pref-appearance' },
		...(devices ? [{ value: 'devices', label: 'Devices', hint: 'Sign in to this account from an app.', id: 'ap-pref-devices' }] : [])
	]);
	let preferencesSection = $state('notifications');
	/** While push is on, checked scopes this server doesn't push say they are desktop only. */
	let scopeNotes = $derived(notifyScopeNotes(notifyScopes, webPush?.offered ?? [], webPush?.enabled === true));
	/** Push is on, but `wake` (the checked scopes the server pushes) is empty: it wakes for nothing. */
	let pushesNothing = $derived(pushWake(notifyScopes, webPush?.offered ?? [])?.length === 0);
	let interfaceFontDraft = $state('');
	let chatFontDraft = $state('');
	let monoFontDraft = $state('');
	let localFontFamilies = $state<string[]>([]);
	let fontBrowserState = $state<FontBrowserState>('idle');
	let fontError = $state('');
	let testNotificationStatus = $state<'idle' | 'sending' | NotificationTestResult>('idle');
	let deviceStatus = $state<'idle' | 'adding' | 'copied' | 'copy-failed'>('idle');
	let deviceToken = $state<DeviceToken | undefined>();
	let deviceError = $state('');

	type Note = { text: string; tone?: 'ok' | 'err' };
	/**
	 * What the Notifications switch says under it, which the switch refers to: whether it
	 * is on, and how far it reaches, only while Apron is open or while it's closed too
	 * (push, §4.9), with why not. `action` turns push on here when it could be.
	 */
	let notificationsNote = $derived.by((): Note & { action?: string } => {
		if (notificationPermission === 'denied') return { text: 'Notifications are blocked by your browser. Allow them in this site’s browser settings, then try again.', tone: 'err' };
		if (!notificationsSupported) return { text: 'Notifications aren’t available here. Use a supported browser over HTTPS or localhost.' };
		if (!notificationsEnabled) return { text: notificationPermission === 'granted' ? 'Off.' : 'Turning this on will ask your browser for permission.' };
		const open = 'On · alerts while Apron is open.';
		if (!webPush) return { text: `${open} This server doesn’t alert when it’s closed.`, tone: 'ok' };
		if (webPush.signIn) return { text: `${open} Sign in to be alerted when it’s closed, too.`, tone: 'ok' };
		if (webPush.error) return { text: webPush.error, tone: 'err' };
		if (!webPush.supported) return { text: webPush.homeScreen ? `${open} To be alerted when it’s closed, add Apron to your Home Screen.` : `${open} This browser can’t alert when it’s closed.`, tone: 'ok' };
		if (webPush.heldBy) return { text: `${open} When it’s closed, this browser alerts for one server at a time: now ${webPush.heldBy}.`, tone: 'ok', action: 'Alert for this server instead' };
		if (webPush.enabled && pushesNothing) return { text: `${open} This server sends none of your choices above when it’s closed.`, tone: 'ok' };
		if (webPush.enabled) return { text: 'On · alerts on this device, even when Apron is closed.', tone: 'ok' };
		return { text: `${open} Not yet when it’s closed.`, tone: 'ok', action: 'Alert when it’s closed, too' };
	});
	let notificationsLocked = $derived(!notificationsEnabled && (!notificationsSupported || notificationPermission === 'denied'));
	/** What the test notification did. */
	let testNote = $derived.by((): Note | undefined => {
		if (testNotificationStatus === 'sent') return { text: 'Test notification sent. Check your system notification area.', tone: 'ok' };
		if (testNotificationStatus === 'denied') return { text: 'Permission was denied; allow notifications in your browser’s site settings.', tone: 'err' };
		if (testNotificationStatus === 'unsupported') return { text: 'Notifications aren’t supported in this browser or connection.' };
		if (testNotificationStatus === 'error') return { text: 'The browser couldn’t display the test notification.', tone: 'err' };
		return undefined;
	});
	let pauseNote = $derived(pause?.until !== undefined ? `Notifications paused ${pausedUntilLabel(pause.until)}.` : pause ? 'Notifications resumed.' : undefined);

	/**
	 * One live region, always in the page, says each status as it changes:
	 * notes that come and go are often not read when they are live regions
	 * themselves.
	 */
	let announcement = $state('');
	/** What the server answered for a status choice, when it isn't what was asked (`StatusPicker`). */
	let statusAnswer = $state<string | undefined>();
	let announced: Record<string, string | undefined> | undefined;
	$effect(() => {
		const now: Record<string, string | undefined> = { notifications: notificationsNote.text, test: testNote?.text, pause: pauseNote, status: statusAnswer };
		const before = announced;
		announced = now;
		if (!before) return;
		const changed = Object.keys(now).find((key) => now[key] !== before[key] && now[key] !== undefined);
		if (changed) announcement = now[changed]!;
	});
	/** Each time it opens, the font drafts start from what is saved, and earlier results clear. */
	$effect(() => {
		if (!open) return;
		untrack(() => {
			interfaceFontDraft = appearanceSettings.current.interfaceFont;
			chatFontDraft = appearanceSettings.current.chatFont;
			monoFontDraft = appearanceSettings.current.monoFont;
			localFontFamilies = [];
			fontBrowserState = typeof window !== 'undefined' && typeof (window as LocalFontAccessWindow).queryLocalFonts === 'function' ? 'idle' : 'unsupported';
			fontError = '';
			testNotificationStatus = 'idle';
			deviceStatus = 'idle';
			deviceToken = undefined;
			deviceError = '';
		});
	});

	async function addDevice(): Promise<void> {
		if (!devices) return;
		deviceStatus = 'adding';
		deviceError = '';
		try {
			deviceToken = await devices.onadd();
		} catch (cause) {
			deviceError = cause instanceof Error ? cause.message : 'Couldn’t create a token.';
		}
		deviceStatus = 'idle';
	}

	async function copyDeviceToken(): Promise<void> {
		if (!deviceToken) return;
		try {
			await navigator.clipboard.writeText(deviceToken.token);
			deviceStatus = 'copied';
		} catch {
			deviceStatus = 'copy-failed';
		}
	}

	async function sendTestNotification(): Promise<void> {
		testNotificationStatus = 'sending';
		try {
			testNotificationStatus = await ontestnotifications();
		} catch {
			testNotificationStatus = 'error';
		}
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

	function preferencesClosed(): void {
		localFontFamilies = [];
		fontBrowserState = 'idle';
		onclosed?.();
	}
</script>

<Dialog bind:open title="Preferences" size="lg" closeLabel="Close preferences" backdropCloses flush onclose={preferencesClosed}>
	<SettingsSections {sections} bind:current={preferencesSection}>
		{#if preferencesSection === 'notifications'}
			<p class="ap-sr" aria-live="polite" aria-atomic="true">{announcement}</p>
			{#if status}
				<StatusPicker status={status.value} accepted={status.accepted} unsupported={status.unsupported} onchoose={status.onchoose} onunsupported={status.onunsupported} onannounce={(text) => (statusAnswer = text)} disabled={status.disabled} />
			{/if}
			{#if pause}
				<PauseNotifications until={pause.until} {onpause} {onresume} />
			{/if}
			<div class="ap-pref-scopes">
				<CheckList
					label="Notify me about"
					options={NOTIFY_SCOPES.map((scope) => ({ value: scope.value, title: scope.title, ...(scopeNotes[scope.value] ? { note: scopeNotes[scope.value] } : {}) }))}
					value={notifyScopes}
					min={1}
					onchange={onnotifyscopes}
				/>
				<p class="ap-pref-help">Whether Apron is open or closed. At least one stays on; the switch below turns notifications off.</p>
			</div>
			<SettingRow title="Notifications" hint="Alerts on this device while you’re away from Apron, and when it’s closed where your browser and this server can." class="ap-pref-notifications">
				<p class={['ap-pref-note', notificationsNote.tone === 'ok' && 'ap-tone-ok', notificationsNote.tone === 'err' && 'ap-tone-danger']} id="ap-pref-notifications-note">{notificationsNote.text}</p>
				<p class="ap-pref-test">
					{#if notificationsNote.action}<Button size="sm" variant="ghost" label={notificationsNote.action} onclick={onwebpush} />{/if}
					<Button size="sm" variant="ghost" label={testNotificationStatus === 'sending' ? 'Sending…' : 'Send a test notification'} disabled={testNotificationStatus === 'sending' || !notificationsSupported || notificationPermission === 'denied'} onclick={sendTestNotification} />
				</p>
				{#if testNote}<p class={['ap-pref-note', testNote.tone === 'ok' && 'ap-tone-ok', testNote.tone === 'err' && 'ap-tone-danger']}>{testNote.text}</p>{/if}
				{#snippet control()}
					<Switch checked={notificationsEnabled} label="Notifications" locked={notificationsLocked} describedby="ap-pref-notifications-note" onchange={onnotifications} />
				{/snippet}
			</SettingRow>
			{#if webPush?.homeScreen}
				<div class="ap-pref-push-more">
					<Callout title="Add Apron to your Home Screen to be alerted when it’s closed">
						<ol>
							<li>Tap Share in Safari.</li>
							<li>Choose Add to Home Screen.</li>
							<li>Open Apron from your Home Screen and turn notifications on there.</li>
						</ol>
					</Callout>
				</div>
			{:else if webPush?.installable}
				<div class="ap-pref-push-more">
					<Callout title="Install Apron as an app">
						<p>It opens in its own window, with its notifications.</p>
						{#snippet action()}<Button size="sm" variant="primary" label="Install app" onclick={oninstallapp} />{/snippet}
					</Callout>
				</div>
			{/if}
		{:else if preferencesSection === 'devices' && devices}
			<SettingRow title="Sign in an app" hint="An app that can’t use this browser’s passkeys, such as one on your phone, signs in as you with a token from here. Keep it private: anyone with it can sign in as you." class="ap-pref-device-setting">
				{#if deviceToken}
					<div class="ap-pref-device-token">
						<label class="ap-pref-help" for="ap-device-token">Token</label>
						<div class="ap-pref-device-copy">
							<input id="ap-device-token" class="ap-field" readonly value={deviceToken.token} onfocus={(event) => event.currentTarget.select()} />
							<Button size="sm" label={deviceStatus === 'copied' ? 'Copied' : 'Copy'} onclick={copyDeviceToken} />
						</div>
						<p class="ap-pref-help">{deviceToken.origin ? `The app signs in from ${deviceToken.origin}, the origin it was issued for.` : 'The app signs in without an origin, as it was issued.'}</p>
						{#if deviceStatus === 'copy-failed'}<p class="ap-pref-note ap-tone-danger" role="alert">Couldn’t copy; select the token and copy it.</p>{/if}
					</div>
				{/if}
				{#if deviceError}<p class="ap-pref-note ap-tone-danger" role="alert">{deviceError}</p>{/if}
				{#snippet control()}
					<Button class="ap-pref-device-create" size="sm" variant={deviceToken ? 'ghost' : 'primary'} label={deviceStatus === 'adding' ? 'Creating…' : deviceToken ? 'Create another' : 'Create token'} disabled={deviceStatus === 'adding'} aria-busy={deviceStatus === 'adding'} onclick={addDevice} />
				{/snippet}
			</SettingRow>
		{:else}
			<SettingRow title="Theme" for="ap-theme-mode" hint="System follows your operating system’s light or dark preference." class="ap-pref-theme-setting">
				{#snippet control()}
					<select id="ap-theme-mode" class="ap-field ap-pref-select" value={appearanceSettings.current.mode} onchange={(event) => setThemeMode(event.currentTarget.value)}>
						<option value="system">System</option>
						<option value="light">Light</option>
						<option value="dark">Dark</option>
					</select>
				{/snippet}
			</SettingRow>
			<SettingRow title="Fonts" badge="Experimental" hint="Customize the interface, chat, and monospace fonts on this device. Font choices are an experiment and will be replaced by a choice of themes." stacked class="ap-pref-font-setting">
				{#snippet control()}
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
						{#if fontError}<p class="ap-pref-note ap-tone-danger" role="alert">{fontError}</p>{/if}
						<div class="ap-pref-font-actions">
							<Button size="sm" variant="ghost" label="Reset fonts" onclick={resetFonts} />
							<Button type="submit" size="sm" variant="primary" label="Apply fonts" />
						</div>
					</form>
				{/snippet}
			</SettingRow>
		{/if}
	</SettingsSections>
</Dialog>
