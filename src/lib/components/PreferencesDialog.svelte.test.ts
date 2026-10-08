// @vitest-environment jsdom
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { appearanceSettings, DEFAULT_APPEARANCE } from '$lib/ui/appearance.svelte';
import PreferencesDialog from './PreferencesDialog.svelte';

let instance: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
});

/** The dialog's props, as the page gives them, with `notifications` overrides. */
function notificationProps(overrides: Record<string, unknown> = {}) {
	return {
		open: false,
		notificationsEnabled: true,
		notificationsSupported: true,
		notificationPermission: 'granted' as const,
		notifyScopes: ['mentions', 'replies'],
		onnotifications: () => undefined,
		onnotifyscopes: () => undefined,
		ontestnotifications: async () => 'sent' as const,
		onwebpush: () => undefined,
		onpause: () => undefined,
		onresume: () => undefined,
		oninstallapp: () => undefined,
		...overrides
	};
}

const push = { supported: true, homeScreen: false, enabled: false, offered: ['mentions', 'replies'], installable: false };

/** The one Notifications switch's note, its action (if any), and how many switches the section has. */
function notifications(props: Record<string, unknown>) {
	instance = mount(PreferencesDialog, { target: document.body, props: notificationProps(props) });
	flushSync();
	const note = document.getElementById('ap-pref-notifications-note')?.textContent ?? '';
	const action = [...document.querySelectorAll<HTMLButtonElement>('.ap-pref-test button')].find((button) => !button.textContent?.includes('test'));
	const switches = document.querySelectorAll('.ap-preferences-content [role="switch"], .ap-preferences-content input[type="checkbox"][role="switch"]').length;
	unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
	return { note, action: action?.textContent?.trim(), switches };
}

describe('PreferencesDialog', () => {
	it('has one Notifications switch that says how far it reaches, open or closed', () => {
		expect(notifications({ webPush: { ...push, enabled: true } })).toEqual({ note: 'On · alerts on this device, even when Apron is closed.', action: undefined, switches: 1 });
		expect(notifications({ webPush: undefined }).note).toBe('On · alerts while Apron is open. This server doesn’t alert when it’s closed.');
		expect(notifications({ webPush: { ...push, signIn: true } }).note).toBe('On · alerts while Apron is open. Sign in to be alerted when it’s closed, too.');
		expect(notifications({ webPush: { ...push, supported: false, homeScreen: true } }).note).toBe('On · alerts while Apron is open. To be alerted when it’s closed, add Apron to your Home Screen.');
		expect(notifications({ webPush: { ...push, supported: false } }).note).toBe('On · alerts while Apron is open. This browser can’t alert when it’s closed.');
		expect(notifications({ webPush: { ...push, enabled: true }, notifyScopes: ['joined'] }).note).toBe('On · alerts while Apron is open. This server sends none of your choices above when it’s closed.');
		// Off, before and after permission; blocked.
		expect(notifications({ notificationsEnabled: false, notificationPermission: 'default', webPush: push }).note).toBe('Turning this on will ask your browser for permission.');
		expect(notifications({ notificationsEnabled: false, webPush: push }).note).toBe('Off.');
		expect(notifications({ notificationsEnabled: false, notificationPermission: 'denied', webPush: push }).note).toMatch(/^Notifications are blocked/);
	});

	it('offers to alert when Apron is closed too, or for this server instead, where push could but doesn\'t yet', () => {
		expect(notifications({ webPush: push })).toEqual({ note: 'On · alerts while Apron is open. Not yet when it’s closed.', action: 'Alert when it’s closed, too', switches: 1 });
		const held = notifications({ webPush: { ...push, enabled: true, heldBy: 'chat.example' } });
		expect(held.note).toBe('On · alerts while Apron is open. When it’s closed, this browser alerts for one server at a time: now chat.example.');
		expect(held.action).toBe('Alert for this server instead');
		// The action is push's.
		let pushed = 0;
		instance = mount(PreferencesDialog, { target: document.body, props: notificationProps({ webPush: push, onwebpush: () => pushed++ }) });
		flushSync();
		[...document.querySelectorAll<HTMLButtonElement>('.ap-pref-test button')].find((button) => button.textContent?.includes('closed'))!.click();
		expect(pushed).toBe(1);
	});


	it('says the status picker\'s answer in its one live region', async () => {
		const props = $state({
			open: false,
			notificationsEnabled: false,
			notificationsSupported: true,
			notificationPermission: 'default' as const,
			notifyScopes: [] as string[],
			onnotifications: () => undefined,
			onnotifyscopes: () => undefined,
			ontestnotifications: async () => 'sent' as const,
			onwebpush: () => undefined,
			onpause: () => undefined,
			onresume: () => undefined,
			oninstallapp: () => undefined,
			status: {
				value: 'online' as string | undefined,
				accepted: ['invisible'],
				unsupported: [] as string[],
				onchoose: async (asked: string) => {
					const kept = asked === 'invisible' ? '' : asked;
					props.status.value = kept;
					return kept;
				},
				onunsupported: () => undefined
			}
		});
		instance = mount(PreferencesDialog, { target: document.body, props });
		flushSync();
		const live = document.querySelector('.ap-sr[aria-live="polite"]')!;
		document.querySelector<HTMLButtonElement>('.ap-status-pick button[aria-haspopup="menu"]')!.click();
		flushSync();
		await tick();
		[...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find((item) => item.textContent?.includes('Invisible'))!.click();
		flushSync();
		await tick();
		await tick();
		flushSync();
		expect(live.textContent).toBe('This server doesn’t offer Invisible. Your status is None.');
	});

	it('applies a premade theme at once, and edited CSS as the custom theme', () => {
		appearanceSettings.update({ ...DEFAULT_APPEARANCE });
		instance = mount(PreferencesDialog, { target: document.body, props: notificationProps() });
		flushSync();
		[...document.querySelectorAll<HTMLButtonElement>('.ap-preferences-nav button')].find((button) => button.textContent === 'Appearance')!.click();
		flushSync();
		const root = document.documentElement;
		const select = document.querySelector<HTMLSelectElement>('#ap-theme')!;
		const css = document.querySelector<HTMLTextAreaElement>('#ap-theme-css')!;
		const apply = document.querySelector<HTMLButtonElement>('.ap-pref-theme-css button[type="submit"]')!;

		select.value = 'ferrous';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		flushSync();
		expect(root.style.getPropertyValue('--font-mono')).toBe('"RecMonoCasual Nerd Font", "Rec Mono Casual", var(--font-mono-system)');
		expect(css.value).toContain('Recursive Sans Casual Static');
		expect(apply.disabled).toBe(true);

		// CSS that doesn't read says why, and changes nothing.
		css.value = '--accent: url(x);';
		css.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		apply.click();
		flushSync();
		expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/url\(\)/);
		expect(appearanceSettings.current.theme).toBe('ferrous');

		css.value = css.value.replace('url(x)', '#3cb4f2');
		css.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		apply.click();
		flushSync();
		expect(appearanceSettings.current).toEqual({ mode: 'system', theme: 'custom', customCss: '--accent: #3cb4f2;' });
		expect(select.value).toBe('custom');
		expect(root.style.getPropertyValue('--accent')).toBe('#3cb4f2');
		// The previous theme's tokens go.
		expect(root.style.getPropertyValue('--font-mono')).toBe('');
		expect(JSON.parse(localStorage.getItem('apron.appearance')!).vars).toEqual([['--accent', '#3cb4f2']]);

		select.value = 'apron';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		flushSync();
		expect(root.style.getPropertyValue('--accent')).toBe('');
		appearanceSettings.update({ ...DEFAULT_APPEARANCE });
	});
});
