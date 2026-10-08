<script lang="ts">
	import { untrack } from 'svelte';
	import { appearanceSettings, cssForTheme, parseThemeCss, THEME_CSS_MAX, THEMES, type ThemeId, type ThemeMode } from '$lib/ui/appearance.svelte';
	import type { NotificationPermissionState, NotificationTestResult } from '$lib/ui/notifications';
	import Button from '$lib/design/components/Button.svelte';
	import Callout from '$lib/design/components/Callout.svelte';
	import CheckList from '$lib/design/components/CheckList.svelte';
	import Dialog from '$lib/design/components/Dialog.svelte';
	import Switch from '$lib/design/components/Switch.svelte';
	import { pausedUntilLabel, type PausedUntil } from '$lib/ui/pause';
	import PauseNotifications from './PauseNotifications.svelte';
	import StatusPicker from './StatusPicker.svelte';
	import { NOTIFY_SCOPES, notifyScopeNotes, pushWake } from '$lib/ui/notify-scopes';
	import type { WebPushPreference } from '$lib/ui/web-push';

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
		onclosed?: () => void;
	}

	let { open = $bindable(false), notificationsEnabled, notificationsSupported, notificationPermission, notifyScopes, onnotifications, onnotifyscopes, ontestnotifications, webPush, onwebpush, oninstallapp, pause, onpause, onresume, status, onclosed }: Props = $props();

	let preferencesSection = $state<'notifications' | 'appearance'>('notifications');
	/** While push is on, checked scopes this server doesn't push say they are desktop only. */
	let scopeNotes = $derived(notifyScopeNotes(notifyScopes, webPush?.offered ?? [], webPush?.enabled === true));
	/** Push is on, but `wake` (the checked scopes the server pushes) is empty: it wakes for nothing. */
	let pushesNothing = $derived(pushWake(notifyScopes, webPush?.offered ?? [])?.length === 0);
	/** The theme's CSS as edited; applying it makes it the custom theme. */
	let themeDraft = $state('');
	let themeError = $state('');
	let themeEdited = $derived(themeDraft !== cssForTheme(appearanceSettings.current));
	let testNotificationStatus = $state<'idle' | 'sending' | NotificationTestResult>('idle');

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
	/** Each time it opens, the theme's CSS starts from what is saved, and earlier results clear. */
	$effect(() => {
		if (!open) return;
		untrack(() => {
			themeDraft = cssForTheme(appearanceSettings.current);
			themeError = '';
			testNotificationStatus = 'idle';
		});
	});

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

	/**
	 * A premade theme applies at once. Custom applies the saved custom CSS, or,
	 * the first time, the theme it was chosen from, edits included.
	 */
	function chooseTheme(theme: string): void {
		if (theme !== 'custom' && !THEMES.some((premade) => premade.id === theme)) return;
		const customCss = theme === 'custom' ? appearanceSettings.current.customCss || themeDraft : appearanceSettings.current.customCss;
		const { error } = parseThemeCss(customCss);
		if (theme === 'custom' && error) {
			themeError = error;
			return;
		}
		appearanceSettings.update({ ...appearanceSettings.current, theme: theme as ThemeId, customCss });
		themeDraft = cssForTheme(appearanceSettings.current);
		themeError = '';
	}

	/** Edited CSS becomes the custom theme, whichever theme it started from. */
	function applyTheme(event: SubmitEvent): void {
		event.preventDefault();
		const { error } = parseThemeCss(themeDraft);
		if (error) {
			themeError = error;
			return;
		}
		appearanceSettings.update({ ...appearanceSettings.current, theme: 'custom', customCss: themeDraft });
		themeError = '';
	}

	function discardTheme(): void {
		themeDraft = cssForTheme(appearanceSettings.current);
		themeError = '';
	}

	function preferencesClosed(): void {
		onclosed?.();
	}
</script>

<Dialog bind:open title="Preferences" size="lg" closeLabel="Close preferences" backdropCloses flush onclose={preferencesClosed}>
	<div class="ap-preferences-body">
		<nav class="ap-preferences-nav" aria-label="Preference sections">
			<button type="button" aria-current={preferencesSection === 'notifications' ? 'page' : undefined} onclick={() => (preferencesSection = 'notifications')}>Notifications</button>
			<button type="button" aria-current={preferencesSection === 'appearance' ? 'page' : undefined} onclick={() => (preferencesSection = 'appearance')}>Appearance</button>
		</nav>
		{#if preferencesSection === 'notifications'}
			<section class="ap-preferences-content" aria-labelledby="ap-pref-notifications">
				<h3 id="ap-pref-notifications">Notifications</h3>
				<p class="ap-profedit-hint">Choose when Apron can interrupt you.</p>
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
				<div class="ap-pref-setting ap-pref-notifications">
					<div>
						<strong>Notifications</strong>
						<p class="ap-profedit-hint">Alerts on this device while you’re away from Apron, and when it’s closed where your browser and this server can.</p>
						<p class={['ap-pref-note', notificationsNote.tone === 'ok' && 'ap-profedit-ok', notificationsNote.tone === 'err' && 'ap-profedit-err']} id="ap-pref-notifications-note">{notificationsNote.text}</p>
						<p class="ap-pref-test">
							{#if notificationsNote.action}<button class="ap-btn ap-btn-ghost ap-btn-sm" type="button" onclick={onwebpush}>{notificationsNote.action}</button>{/if}
							<button class="ap-btn ap-btn-ghost ap-btn-sm" type="button" disabled={testNotificationStatus === 'sending' || !notificationsSupported || notificationPermission === 'denied'} onclick={sendTestNotification}>{testNotificationStatus === 'sending' ? 'Sending…' : 'Send a test notification'}</button>
						</p>
						{#if testNote}<p class={['ap-pref-note', testNote.tone === 'ok' && 'ap-profedit-ok', testNote.tone === 'err' && 'ap-profedit-err']}>{testNote.text}</p>{/if}
					</div>
					<Switch checked={notificationsEnabled} label="Notifications" locked={notificationsLocked} describedby="ap-pref-notifications-note" onchange={onnotifications} />
				</div>
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
			</section>
		{:else}
			<section class="ap-preferences-content" aria-labelledby="ap-pref-appearance">
				<h3 id="ap-pref-appearance">Appearance</h3>
				<p class="ap-profedit-hint">Adjust light or dark, and the theme, on this device.</p>
				<div class="ap-pref-setting ap-pref-theme-setting">
					<div>
						<label for="ap-theme-mode">Mode</label>
						<p class="ap-profedit-hint">System follows your operating system’s light or dark preference.</p>
					</div>
					<select id="ap-theme-mode" class="ap-field ap-pref-select" value={appearanceSettings.current.mode} onchange={(event) => setThemeMode(event.currentTarget.value)}>
						<option value="system">System</option>
						<option value="light">Light</option>
						<option value="dark">Dark</option>
					</select>
				</div>
				<div class="ap-pref-setting ap-pref-theme-setting">
					<div>
						<label for="ap-theme">Theme</label>
						<p class="ap-profedit-hint">Fonts and other design tokens, over either mode. A theme’s fonts need to be installed on this device.</p>
					</div>
					<select id="ap-theme" class="ap-field ap-pref-select" value={appearanceSettings.current.theme} onchange={(event) => {
						chooseTheme(event.currentTarget.value);
						// Custom with CSS that doesn't read stays on the theme before, saying why.
						event.currentTarget.value = appearanceSettings.current.theme;
					}}>
						{#each THEMES as theme (theme.id)}<option value={theme.id}>{theme.name}</option>{/each}
						<option value="custom">Custom</option>
					</select>
				</div>
				<form class="ap-pref-theme-css" onsubmit={applyTheme}>
					<label class="ap-pref-css-label" for="ap-theme-css">Theme CSS</label>
					<p class="ap-pref-help" id="ap-theme-css-hint">Edit the tokens, then apply them as your custom theme. Only <code>--token: value;</code> declarations are read, and nothing loads with <code>url()</code>.</p>
					<textarea id="ap-theme-css" class="ap-field ap-field-multi ap-field-mono" rows="12" spellcheck="false" autocomplete="off" maxlength={THEME_CSS_MAX} aria-describedby="ap-theme-css-hint" aria-invalid={themeError ? 'true' : undefined} bind:value={themeDraft} oninput={() => (themeError = '')}></textarea>
					{#if themeError}<p class="ap-pref-note ap-profedit-err" role="alert">{themeError}</p>{/if}
					<div class="ap-pref-theme-actions">
						<button class="ap-btn ap-btn-ghost ap-btn-sm" type="button" disabled={!themeEdited} onclick={discardTheme}>Discard changes</button>
						<button class="ap-btn ap-btn-primary ap-btn-sm" type="submit" disabled={!themeEdited}>{appearanceSettings.current.theme === 'custom' ? 'Apply' : 'Apply as custom theme'}</button>
					</div>
				</form>
			</section>
		{/if}
	</div>
</Dialog>

<style>
	.ap-preferences-body { flex: 1; min-height: 0; display: grid; grid-template-columns: 190px minmax(0, 1fr); }
	.ap-preferences-nav { padding: var(--space-4) var(--space-2); border-right: 1px solid var(--line); }
	.ap-preferences-nav button { width: 100%; padding: var(--space-2) var(--space-3); color: var(--ink); text-align: left; background: transparent; border: 0; border-radius: var(--radius-sm); cursor: pointer; }
	.ap-preferences-nav button[aria-current="page"] { color: var(--ink); background: var(--bg-300); }
	.ap-preferences-content { padding: var(--space-6); overflow-y: auto; }
	.ap-preferences-content h3 { margin: 0; font-size: var(--text-body); line-height: 20px; }
	.ap-preferences-content > p { margin: var(--space-1) 0 var(--space-4); }
	.ap-pref-setting { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); padding: var(--space-4) 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
	.ap-pref-setting strong { font-size: var(--text-field); }
	.ap-pref-setting p { max-width: 420px; margin: var(--space-1) 0 0; }
	.ap-pref-theme-setting label { color: var(--ink); font-size: var(--text-field); font-weight: 600; cursor: pointer; }
	.ap-pref-theme-setting select { flex: none; }
	.ap-pref-theme-setting + .ap-pref-theme-setting { border-top: 0; }
	.ap-pref-setting .ap-pref-test { display: flex; flex-wrap: wrap; gap: var(--space-1); margin: var(--space-2) 0 0 calc(-1 * var(--space-3)); }
	.ap-pref-notifications:has(+ .ap-pref-push-more) { border-bottom: 0; }
	.ap-pref-push-more { max-width: 460px; padding-bottom: var(--space-4); }
	.ap-pref-scopes { max-width: 460px; padding: var(--space-4) 0; }
	.ap-pref-note { margin: var(--space-3) 0; color: var(--ink-muted); font-size: var(--text-ui); line-height: 19px; }
	.ap-pref-select { width: min(100%, 320px); }
	.ap-pref-help { margin: var(--space-1) 0 0; color: var(--ink-muted); font-size: var(--text-sm); line-height: 17px; }
	.ap-pref-theme-css { padding: var(--space-4) 0; }
	.ap-pref-css-label { color: var(--ink); font-size: var(--text-field); font-weight: 600; }
	.ap-pref-theme-css .ap-pref-help { max-width: 460px; margin-bottom: var(--space-2); }
	.ap-pref-theme-css code { font-family: var(--font-mono); }
	.ap-pref-theme-css textarea { display: block; width: 100%; tab-size: 2; }
	.ap-pref-theme-actions { display: flex; justify-content: flex-end; gap: var(--space-2); margin-top: var(--space-3); }
	@media (max-width: 560px) {
		.ap-preferences-body { grid-template-columns: 130px minmax(0, 1fr); }
		.ap-preferences-content { padding: var(--space-4); }
	}
</style>
