<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import { historySettings, RETENTIONS, storageUsed } from '$lib/history/settings.svelte';
	import { MEDIA_POLICIES, mediaSettings, parseMediaOrigins } from '$lib/ui/media-settings.svelte';
	import { appearanceSettings, cssForTheme, parseThemeCss, THEME_CSS_MAX, THEMES, type ThemeId, type ThemeMode } from '$lib/ui/appearance.svelte';
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

	interface Props {
		open?: boolean;
		/** The section shown: `profile`, `notifications`, `appearance`, `media` or `history`. Bindable. */
		section?: string;
		/** Profile's form, under your status: your avatar, handle and bio, and how you sign in. */
		profile?: Snippet;
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
		onexport?: (options: { privateRooms: boolean }) => Promise<{ name: string; rooms: number; messages: number; privateLeftOut: number } | undefined>;
		/** The host of the server connected to, which media always loads from. */
		serverHost?: string;
		/** The sites this server names for its media (`ext:media`), as hosts: trusted with it. */
		mediaHosts?: readonly string[];
		onclosed?: () => void;
	}

	let { open = $bindable(false), section: preferencesSection = $bindable('profile'), profile, notificationsEnabled, notificationsSupported, notificationPermission, notifyScopes, onnotifications, onnotifyscopes, ontestnotifications, webPush, onwebpush, oninstallapp, pause, onpause, onresume, status, onexport, serverHost, mediaHosts = [], onclosed }: Props = $props();

	const SECTIONS = [
		{ value: 'profile', label: 'Profile', id: 'ap-pref-profile' },
		{ value: 'notifications', label: 'Notifications', id: 'ap-pref-notifications' },
		{ value: 'appearance', label: 'Appearance', id: 'ap-pref-appearance' },
		{ value: 'media', label: 'Media', id: 'ap-pref-media' },
		{ value: 'history', label: 'History', id: 'ap-pref-history' }
	];
	/** While push is on, checked scopes this server doesn't push say they are desktop only. */
	let scopeNotes = $derived(notifyScopeNotes(notifyScopes, webPush?.offered ?? [], webPush?.enabled === true));
	/** Push is on, but `wake` (the checked scopes the server pushes) is empty: it wakes for nothing. */
	let pushesNothing = $derived(pushWake(notifyScopes, webPush?.offered ?? [])?.length === 0);
	/** The theme's CSS as edited; applying it makes it the custom theme. */
	let themeDraft = $state('');
	let themeError = $state('');
	/** Why the CSS as typed isn't on show, while it doesn't read. */
	let draftError = $state('');
	let themeEdited = $derived(themeDraft !== cssForTheme(appearanceSettings.current));
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
	/** Export's Include private rooms: off each time Preferences opens, so private rooms go only when asked for. */
	let exportPrivate = $state(false);

	/** What the chosen media policy loads, under it: the server, by name, and the trusted origins. */
	let mediaNote = $derived(mediaSettings.policy === 'any' ? 'Everything, from any site.' : `From ${serverHost ?? 'this server'} and the trusted origins below. Other images wait for a click.`);
	/** The trusted origins, one per line as hosts, as the field shows them. */
	let addedSites = $derived(mediaSettings.origins.map((origin) => new URL(origin).host).join('\n'));

	type Note = { text: string; tone?: 'ok' | 'err' };
	/**
	 * What the Notifications switch says under it, which the switch refers to: whether it
	 * is on, and how far it reaches, only while Apron is open or while it's closed too
	 * (push, §4.9), with why not. `action` turns push on here when it could be.
	 */
	let notificationsNote = $derived.by((): Note & { action?: string } => {
		if (notificationPermission === 'denied') return { text: 'Blocked by your browser. Allow notifications in its site settings.', tone: 'err' };
		if (!notificationsSupported) return { text: 'Not available here. Use a supported browser over HTTPS.' };
		if (!notificationsEnabled) return { text: notificationPermission === 'granted' ? 'Off.' : 'Your browser will ask for permission.' };
		const open = 'On while Apron is open.';
		if (!webPush) return { text: `${open} This server can’t alert when it’s closed.`, tone: 'ok' };
		if (webPush.signIn) return { text: `${open} Sign in to be alerted when it’s closed.`, tone: 'ok' };
		if (webPush.error) return { text: webPush.error, tone: 'err' };
		if (!webPush.supported) return { text: webPush.homeScreen ? `${open} Add it to your Home Screen to be alerted when it’s closed.` : `${open} This browser can’t alert when it’s closed.`, tone: 'ok' };
		if (webPush.heldBy) return { text: `${open} When it’s closed, this browser alerts only for ${webPush.heldBy}.`, tone: 'ok', action: 'Alert for this server instead' };
		if (webPush.enabled && pushesNothing) return { text: `${open} None of your choices below alert when it’s closed.`, tone: 'ok' };
		if (webPush.enabled) return { text: 'On, even when Apron is closed.', tone: 'ok' };
		return { text: open, tone: 'ok', action: 'Alert when it’s closed, too' };
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
	/** Each time it opens, the theme's CSS starts from what is saved, and earlier results clear. */
	$effect(() => {
		if (!open) return;
		untrack(() => {
			themeDraft = cssForTheme(appearanceSettings.current);
			themeError = '';
			draftError = '';
			testNotificationStatus = 'idle';
			exportNote = undefined;
		});
	});

	async function exportChats(): Promise<void> {
		if (!onexport || exporting) return;
		exporting = true;
		let saved: Awaited<ReturnType<typeof onexport>>;
		try {
			saved = await onexport({ privateRooms: exportPrivate });
		} catch {
			exportNote = 'The export couldn’t be saved. Try again, or free up memory by closing other tabs.';
			return;
		} finally {
			exporting = false;
		}
		const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
		const leftOut = saved?.privateLeftOut ? `; ${count(saved.privateLeftOut, 'private room')} left out` : '';
		exportNote = saved ? `Saved ${saved.name}: ${count(saved.messages, 'message')} in ${count(saved.rooms, 'room')}${leftOut}.` : 'Nothing is loaded to export yet.';
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
		// Custom CSS being edited stays on show in the new mode.
		if (themeEdited) appearanceSettings.preview(themeDraft);
	}

	/**
	 * A theme applies at once. Custom shows its CSS: the saved custom theme, or,
	 * the first time, the CSS of the theme it was chosen from.
	 */
	function chooseTheme(theme: string): void {
		if (theme !== 'custom' && !THEMES.some((premade) => premade.id === theme)) return;
		const customCss = theme === 'custom' ? appearanceSettings.current.customCss || cssForTheme(appearanceSettings.current) : appearanceSettings.current.customCss;
		appearanceSettings.update({ ...appearanceSettings.current, theme: theme as ThemeId, customCss });
		themeDraft = cssForTheme(appearanceSettings.current);
		// A saved custom theme that doesn't read (edited in storage) applies nothing, and says why.
		themeError = theme === 'custom' ? (parseThemeCss(customCss).error ?? '') : '';
		draftError = '';
	}

	/** Edited CSS becomes the custom theme. */
	function applyTheme(event: SubmitEvent): void {
		event.preventDefault();
		const { error } = parseThemeCss(themeDraft);
		if (error) {
			themeError = error;
			return;
		}
		appearanceSettings.update({ ...appearanceSettings.current, theme: 'custom', customCss: themeDraft });
		themeError = '';
		draftError = '';
	}

	/**
	 * The CSS shows as it's typed, whenever it reads; Apply saves it. While it doesn't, the last that did stays on
	 * show, and the error says why, quietly (it's announced on Apply, not on every keystroke).
	 */
	function editTheme(): void {
		themeError = '';
		draftError = appearanceSettings.preview(themeDraft) ?? '';
	}

	function discardTheme(): void {
		themeDraft = cssForTheme(appearanceSettings.current);
		themeError = '';
		draftError = '';
		appearanceSettings.revert();
	}

	function preferencesClosed(): void {
		// Edits not applied go with the dialog.
		if (themeEdited) discardTheme();
		onclosed?.();
	}
</script>

<Dialog bind:open title="Preferences" size="lg" closeLabel="Close preferences" backdropCloses flush onclose={preferencesClosed}>
	<SettingsSections sections={SECTIONS} bind:current={preferencesSection}>
		<p class="ap-sr" aria-live="polite" aria-atomic="true">{announcement}</p>
		{#if preferencesSection === 'profile'}
			{#if status}
				<StatusPicker status={status.value} accepted={status.accepted} unsupported={status.unsupported} onchoose={status.onchoose} onunsupported={status.onunsupported} onannounce={(text) => (statusAnswer = text)} disabled={status.disabled} />
			{/if}
			{@render profile?.()}
		{:else if preferencesSection === 'notifications'}
			<SettingRow title="Notifications" class="ap-pref-notifications">
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
				<p class="ap-pref-help">Whether Apron is open or closed. At least one stays on; the switch above turns notifications off.</p>
			</div>
		{:else if preferencesSection === 'media'}
			<SettingRow title="Load images from" for="ap-media-policy" hint={mediaNote} hintTestid="media-note" class="ap-pref-media-setting">
				{#snippet control()}
					<select id="ap-media-policy" class="ap-field ap-pref-select" value={mediaSettings.policy} onchange={(event) => mediaSettings.update(event.currentTarget.value)} data-testid="media-policy">
						{#each MEDIA_POLICIES as policy (policy.value)}<option value={policy.value}>{policy.label}</option>{/each}
					</select>
				{/snippet}
			</SettingRow>
			<SettingRow title="Trusted origins" for="ap-media-sites" hint="One per line, such as cdn.example.com. Each site sees what you load." stacked class="ap-pref-media-sites">
				{#if mediaHosts.length}<p class="ap-form-hint" data-testid="media-server-origins">Includes origins trusted by the server: {mediaHosts.join(', ')}</p>{/if}
				{#snippet control()}
					<textarea id="ap-media-sites" class="ap-field ap-pref-sites" rows="4" spellcheck="false" autocomplete="off" value={addedSites} onchange={(event) => mediaSettings.update(mediaSettings.policy, parseMediaOrigins(event.currentTarget.value))} data-testid="media-sites"></textarea>
				{/snippet}
			</SettingRow>
		{:else if preferencesSection === 'history'}
			<SettingRow title="Retention" for="ap-history-retention" hint="Signing out deletes stored history." class="ap-pref-history-setting">
				{#if historyNote}<p class={['ap-pref-note', historyNote.tone === 'err' && 'ap-tone-danger']}>{historyNote.text}</p>{/if}
				{#snippet control()}
					<select id="ap-history-retention" class="ap-field ap-pref-select" value={historySettings.retention} onchange={(event) => historySettings.update(event.currentTarget.value)} data-testid="history-retention">
						{#each RETENTIONS as retention (retention.value)}<option value={retention.value}>{retention.label}</option>{/each}
					</select>
				{/snippet}
			</SettingRow>
			<SettingRow title="Export chats" hint="Saves what this page has loaded as a .jsonl file.">
				<label class="ap-pref-check"><input class="ap-checklist-box" type="checkbox" bind:checked={exportPrivate} disabled={exporting} data-testid="export-private" /> Include private rooms</label>
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
			<SettingRow title="Mode" for="ap-theme-mode" hint="System follows your operating system’s light or dark preference." class="ap-pref-theme-setting">
				{#snippet control()}
					<select id="ap-theme-mode" class="ap-field ap-pref-select" value={appearanceSettings.current.mode} onchange={(event) => setThemeMode(event.currentTarget.value)}>
						<option value="system">System</option>
						<option value="light">Light</option>
						<option value="dark">Dark</option>
					</select>
				{/snippet}
			</SettingRow>
			<SettingRow title="Theme" for="ap-theme" hint="Fonts and other design tokens, over either mode. The first time, Custom starts from the theme you had." class="ap-pref-theme-setting">
				{#snippet control()}
					<select
						id="ap-theme"
						class="ap-field ap-pref-select"
						value={appearanceSettings.current.theme}
						onchange={(event) => chooseTheme(event.currentTarget.value)}
					>
						{#each THEMES as theme (theme.id)}<option value={theme.id}>{theme.name}</option>{/each}
						<option value="custom">Custom</option>
					</select>
				{/snippet}
			</SettingRow>
			{#if appearanceSettings.current.theme === 'custom'}
				<SettingRow title="Theme CSS" for="ap-theme-css" stacked class="ap-pref-theme-css">
					<p class="ap-form-hint" id="ap-theme-css-hint">Edits show as you type; Apply keeps them. Only <code>--token: value;</code> declarations are read, colors can be <code>light-dark(light, dark)</code>, and nothing loads with <code>url()</code>.</p>
					{#snippet control()}
						<form onsubmit={applyTheme}>
							<textarea id="ap-theme-css" class="ap-field ap-pref-css" rows="12" spellcheck="false" autocomplete="off" maxlength={THEME_CSS_MAX} aria-describedby={['ap-theme-css-hint', (themeError || draftError) && 'ap-theme-css-error'].filter(Boolean).join(' ')} aria-invalid={themeError || draftError ? 'true' : undefined} bind:value={themeDraft} oninput={editTheme} data-testid="theme-css"></textarea>
							{#if themeError}<p class="ap-pref-note ap-tone-danger" id="ap-theme-css-error" role="alert">{themeError}</p>
							{:else if draftError}<p class="ap-pref-note" id="ap-theme-css-error">Not showing yet: {draftError}</p>{/if}
							<div class="ap-pref-theme-actions">
								<Button size="sm" variant="ghost" label="Discard changes" disabled={!themeEdited} onclick={discardTheme} />
								<Button type="submit" size="sm" variant="primary" label="Apply" disabled={!themeEdited} />
							</div>
						</form>
					{/snippet}
				</SettingRow>
			{/if}
		{/if}
	</SettingsSections>
</Dialog>
