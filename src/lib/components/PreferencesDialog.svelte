<script lang="ts">
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { historySettings, RETENTIONS, storageUsed } from '$lib/history/settings.svelte';
	import { MEDIA_POLICIES, mediaSettings, parseMediaOrigins } from '$lib/ui/media-settings.svelte';
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

	type LocalFontAccessWindow = Window & { queryLocalFonts?: () => Promise<Array<{ family: string }>> };

	interface Props {
		open?: boolean;
		/** The section shown: `notifications`, `appearance`, `media` or `history`. Bindable. */
		section?: string;
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
		 * Saves what this page has loaded as an export (`$lib/archive`), and says what it saved: none of it
		 * while nothing is loaded. Absent where there is nothing to export from.
		 */
		onexport?: () => Promise<{ name: string; rooms: number; messages: number } | undefined>;
		/** The sites this server names for its media (`ext:media`), as hosts: what This server loads from besides it. */
		mediaHosts?: readonly string[];
		onclosed?: () => void;
	}

	let { open = $bindable(false), section: preferencesSection = $bindable('notifications'), notificationsEnabled, notificationsSupported, notificationPermission, notifyScopes, onnotifications, onnotifyscopes, ontestnotifications, webPush, onwebpush, oninstallapp, pause, onpause, onresume, status, onexport, mediaHosts = [], onclosed }: Props = $props();

	const SECTIONS = [
		{ value: 'notifications', label: 'Notifications', hint: 'Choose when Apron can interrupt you.', id: 'ap-pref-notifications' },
		{ value: 'appearance', label: 'Appearance', hint: 'Adjust the theme and reading fonts on this device.', id: 'ap-pref-appearance' },
		{ value: 'media', label: 'Media', hint: 'Where images and avatars load from. Each site sees what you load.', id: 'ap-pref-media' },
		{ value: 'history', label: 'History', hint: 'What this device keeps of your chats.', id: 'ap-pref-history' }
	];
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
	/** What the last export saved. */
	let exportNote = $state<string | undefined>();
	/** How much Apron keeps on this device, read as History opens. */
	let used = $state<string | undefined>();
	$effect(() => {
		if (preferencesSection !== 'history' || !open) return;
		let current = true;
		void storageUsed().then((usage) => { if (current) used = usage; });
		return () => { current = false; };
	});
	/** Under the retention: why nothing more is kept, or how much is. */
	let historyNote = $derived<Note | undefined>(historySettings.failure
		? { text: historySettings.failure, tone: 'err' }
		: historySettings.retention !== 'off' && used ? { text: `Using about ${used}.` } : undefined);
	let exporting = $state(false);

	/** What the chosen media policy loads, under it. */
	let mediaNote = $derived.by(() => {
		const server = `this server${mediaHosts.length ? ` and ${mediaHosts.join(', ')}` : ''}`;
		if (mediaSettings.policy === 'all') return 'Everything, from any site.';
		if (mediaSettings.policy === 'standard') return `Previews from ${server}. Avatars and images from any site.`;
		return `Only from ${server}${mediaSettings.policy === 'custom' ? ' and the sites below' : ''}.`;
	});
	/** The sites added, one per line as hosts, as the field shows them. */
	let addedSites = $derived(mediaSettings.origins.map((origin) => new URL(origin).host).join('\n'));

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
		const now: Record<string, string | undefined> = { notifications: notificationsNote.text, test: testNote?.text, pause: pauseNote, status: statusAnswer, exported: exportNote, history: historySettings.failure };
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
			exportNote = undefined;
		});
	});

	async function exportChats(): Promise<void> {
		if (!onexport || exporting) return;
		exporting = true;
		let saved: Awaited<ReturnType<typeof onexport>>;
		try {
			saved = await onexport();
		} catch {
			exportNote = 'The export couldn’t be saved. Try again, or free up memory by closing other tabs.';
			return;
		} finally {
			exporting = false;
		}
		const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
		exportNote = saved ? `Saved ${saved.name}: ${count(saved.messages, 'message')} in ${count(saved.rooms, 'room')}.` : 'Nothing is loaded to export yet.';
	}

	/** The export reader, in a tab of its own, so this page's session carries on. */
	function openExport(): void {
		window.open(resolve('/archive'), '_blank', 'noopener');
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
	<SettingsSections sections={SECTIONS} bind:current={preferencesSection}>
		<p class="ap-sr" aria-live="polite" aria-atomic="true">{announcement}</p>
		{#if preferencesSection === 'notifications'}
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
		{:else if preferencesSection === 'media'}
			<SettingRow title="Load images from" for="ap-media-policy" hint={mediaNote} hintTestid="media-note" class="ap-pref-media-setting">
				{#snippet control()}
					<select id="ap-media-policy" class="ap-field ap-pref-select" value={mediaSettings.policy} onchange={(event) => mediaSettings.update(event.currentTarget.value)} data-testid="media-policy">
						{#each MEDIA_POLICIES as policy (policy.value)}<option value={policy.value}>{policy.label}</option>{/each}
					</select>
				{/snippet}
			</SettingRow>
			{#if mediaSettings.policy === 'custom'}
				<SettingRow title="Sites" for="ap-media-sites" hint="One per line, such as cdn.example.com." stacked class="ap-pref-media-sites">
					{#snippet control()}
						<textarea id="ap-media-sites" class="ap-field ap-pref-sites" rows="4" spellcheck="false" autocomplete="off" value={addedSites} onchange={(event) => mediaSettings.update('custom', parseMediaOrigins(event.currentTarget.value))} data-testid="media-sites"></textarea>
					{/snippet}
				</SettingRow>
			{/if}
		{:else if preferencesSection === 'history'}
			<SettingRow title="Keep history" for="ap-history-retention" hint="Your rooms open at once after a reload. Accounts only; signing out removes it." class="ap-pref-history-setting">
				{#if historyNote}<p class={['ap-pref-note', historyNote.tone === 'err' && 'ap-tone-danger']}>{historyNote.text}</p>{/if}
				{#snippet control()}
					<select id="ap-history-retention" class="ap-field ap-pref-select" value={historySettings.retention} onchange={(event) => historySettings.update(event.currentTarget.value)} data-testid="history-retention">
						{#each RETENTIONS as retention (retention.value)}<option value={retention.value}>{retention.label}</option>{/each}
					</select>
				{/snippet}
			</SettingRow>
			<SettingRow title="Export chats" hint="Saves what this page has loaded as a .jsonl file.">
				{#if exportNote}<p class="ap-pref-note">{exportNote}</p>{/if}
				{#snippet control()}
					<Button size="sm" variant="ghost" label={exporting ? 'Exporting…' : 'Export'} disabled={!onexport} aria-disabled={exporting ? 'true' : undefined} aria-busy={exporting ? 'true' : undefined} onclick={exportChats} data-testid="export-chats" />
				{/snippet}
			</SettingRow>
			<SettingRow title="Open an export" hint="Reads one in a new tab, read-only.">
				{#snippet control()}
					<Button size="sm" variant="ghost" label="Open…" onclick={openExport} />
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
