<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import { appearanceSettings, sanitizeFontFamily, type FontBrowserState, type ThemeMode } from '$lib/ui/appearance.svelte';
	import type { NotificationPermissionState, NotificationScope, NotificationTestResult } from '$lib/ui/notifications';
	import FontFamilyField from './FontFamilyField.svelte';

	type LocalFontAccessWindow = Window & { queryLocalFonts?: () => Promise<Array<{ family: string }>> };

	interface Props {
		open?: boolean;
		notificationsEnabled: boolean;
		notificationsSupported: boolean;
		notificationPermission: NotificationPermissionState;
		notificationScope: NotificationScope;
		onnotifications: () => void;
		onnotificationscope: (scope: NotificationScope) => void;
		ontestnotifications: () => Promise<NotificationTestResult>;
		onclosed?: () => void;
	}

	let { open = $bindable(false), notificationsEnabled, notificationsSupported, notificationPermission, notificationScope, onnotifications, onnotificationscope, ontestnotifications, onclosed }: Props = $props();

	let preferencesSection = $state<'notifications' | 'appearance'>('notifications');
	let interfaceFontDraft = $state('');
	let chatFontDraft = $state('');
	let monoFontDraft = $state('');
	let localFontFamilies = $state<string[]>([]);
	let fontBrowserState = $state<FontBrowserState>('idle');
	let fontError = $state('');
	let testNotificationStatus = $state<'idle' | 'sending' | NotificationTestResult>('idle');
	let preferencesDialog = $state<HTMLDialogElement | undefined>();

	$effect(() => {
		const dialog = preferencesDialog;
		if (!dialog) return;
		if (open && !dialog.open) {
			interfaceFontDraft = appearanceSettings.current.interfaceFont;
			chatFontDraft = appearanceSettings.current.chatFont;
			monoFontDraft = appearanceSettings.current.monoFont;
			localFontFamilies = [];
			fontBrowserState = typeof window !== 'undefined' && typeof (window as LocalFontAccessWindow).queryLocalFonts === 'function' ? 'idle' : 'unsupported';
			fontError = '';
			testNotificationStatus = 'idle';
			dialog.showModal();
		} else if (!open && dialog.open) {
			dialog.close();
		}
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
		preferencesDialog?.close();
	}

	/** Whether the press started on the backdrop, so a selection dragged out of the panel doesn't close it. */
	let pressedBackdrop = false;

	/** A click on the backdrop closes, as the X does: the panel's content fills the dialog, so only the backdrop targets it. */
	function backdropClick(event: MouseEvent): void {
		if (event.target === preferencesDialog && pressedBackdrop) closePreferences();
		pressedBackdrop = false;
	}

	function preferencesClosed(): void {
		open = false;
		localFontFamilies = [];
		fontBrowserState = 'idle';
		onclosed?.();
	}
</script>

<dialog class="ap-preferences" bind:this={preferencesDialog} aria-labelledby="ap-pref-title" onclose={preferencesClosed} onpointerdown={(event) => (pressedBackdrop = event.target === preferencesDialog)} onclick={backdropClick}>
	<header class="ap-preferences-head">
		<div><p>SETTINGS</p><h2 id="ap-pref-title">Preferences</h2></div>
		<button class="ap-btn ap-btn-ghost ap-btn-sm" type="button" aria-label="Close preferences" onclick={closePreferences}><X size={16} aria-hidden="true" /></button>
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
						<strong>Fonts</strong> <span class="ap-pref-experimental">Experimental</span>
						<p class="ap-profedit-hint">Customize the interface, chat, and monospace fonts on this device. Font choices are an experiment and will be replaced by a choice of themes.</p>
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

<style>
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
	.ap-pref-experimental { display: inline-block; margin-left: var(--space-1); padding: 0 var(--space-2); border-radius: var(--radius-full); background: var(--bg-300); color: var(--ink-muted); font-size: 11px; line-height: 18px; font-weight: 500; vertical-align: 1px; }
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
</style>
