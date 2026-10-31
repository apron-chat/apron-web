// @vitest-environment jsdom
import { flushSync, tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { appearanceSettings, DEFAULT_APPEARANCE } from '$lib/ui/appearance.svelte';
import PreferencesDialog from './PreferencesDialog.svelte';
import { render, cleanup } from '$lib/test/dom';

/** The dialog's props, as the page gives them, with `notifications` overrides. */
function notificationProps(overrides: Record<string, unknown> = {}) {
	return {
		open: false,
		section: 'notifications',
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
	render(PreferencesDialog, notificationProps(props));
	const note = document.getElementById('ap-pref-notifications-note')?.textContent ?? '';
	const action = [...document.querySelectorAll<HTMLButtonElement>('.ap-pref-test button')].find((button) => !button.textContent?.includes('test'));
	const switches = document.querySelectorAll('.ap-preferences-content [role="switch"], .ap-preferences-content input[type="checkbox"][role="switch"]').length;
	cleanup();
	return { note, action: action?.textContent?.trim(), switches };
}

describe('PreferencesDialog', () => {
	it('has one Notifications switch that says how far it reaches, open or closed', () => {
		expect(notifications({ webPush: { ...push, enabled: true } })).toEqual({ note: 'On, even when Apron is closed.', action: undefined, switches: 1 });
		expect(notifications({ webPush: undefined }).note).toBe('On while Apron is open. This server can’t alert when it’s closed.');
		expect(notifications({ webPush: { ...push, signIn: true } }).note).toBe('On while Apron is open. Sign in to be alerted when it’s closed.');
		expect(notifications({ webPush: { ...push, supported: false, homeScreen: true } }).note).toBe('On while Apron is open. Add it to your Home Screen to be alerted when it’s closed.');
		expect(notifications({ webPush: { ...push, supported: false } }).note).toBe('On while Apron is open. This browser can’t alert when it’s closed.');
		expect(notifications({ webPush: { ...push, enabled: true }, notifyScopes: ['joined'] }).note).toBe('On while Apron is open. None of your choices below alert when it’s closed.');
		// Off, before and after permission; blocked.
		expect(notifications({ notificationsEnabled: false, notificationPermission: 'default', webPush: push }).note).toBe('Your browser will ask for permission.');
		expect(notifications({ notificationsEnabled: false, webPush: push }).note).toBe('Off.');
		expect(notifications({ notificationsEnabled: false, notificationPermission: 'denied', webPush: push }).note).toMatch(/^Blocked by your browser/);
	});

	it('offers to alert when Apron is closed too, or for this server instead, where push could but doesn\'t yet', () => {
		expect(notifications({ webPush: push })).toEqual({ note: 'On while Apron is open.', action: 'Alert when it’s closed, too', switches: 1 });
		const held = notifications({ webPush: { ...push, enabled: true, heldBy: 'chat.example' } });
		expect(held.note).toBe('On while Apron is open. When it’s closed, this browser alerts only for chat.example.');
		expect(held.action).toBe('Alert for this server instead');
		// The action is push's.
		let pushed = 0;
		render(PreferencesDialog, notificationProps({ webPush: push, onwebpush: () => pushed++ }));
		[...document.querySelectorAll<HTMLButtonElement>('.ap-pref-test button')].find((button) => button.textContent?.includes('closed'))!.click();
		expect(pushed).toBe(1);
	});


	it('exports without private rooms unless Include private rooms is checked, and says how many were left out', async () => {
		const onexport = vi.fn(async ({ privateRooms }: { privateRooms: boolean }) => ({ name: 'apron-chat.example-2026-10-30.jsonl', rooms: 3, messages: 10, privateLeftOut: privateRooms ? 0 : 2 }));
		render(PreferencesDialog, notificationProps({ section: 'history', onexport }));
		const box = document.querySelector<HTMLInputElement>('[data-testid="export-private"]')!;
		expect(box.checked).toBe(false);
		expect(box.closest('label')?.textContent?.trim()).toBe('Include private rooms');
		const note = async () => {
			const calls = onexport.mock.calls.length;
			document.querySelector<HTMLButtonElement>('[data-testid="export-chats"]')!.click();
			await vi.waitFor(() => expect(onexport).toHaveBeenCalledTimes(calls + 1));
			await tick();
			flushSync();
			return document.querySelector('.ap-pref-note')?.textContent;
		};
		expect(await note()).toBe('Saved apron-chat.example-2026-10-30.jsonl: 10 messages in 3 rooms; 2 private rooms left out.');
		expect(onexport).toHaveBeenLastCalledWith({ privateRooms: false });
		box.click();
		flushSync();
		expect(await note()).toBe('Saved apron-chat.example-2026-10-30.jsonl: 10 messages in 3 rooms.');
		expect(onexport).toHaveBeenLastCalledWith({ privateRooms: true });
		cleanup();
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
		render(PreferencesDialog, props);
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
		render(PreferencesDialog, notificationProps({ section: 'appearance' }));
		const root = document.documentElement;
		const select = document.querySelector<HTMLSelectElement>('#ap-theme')!;
		const css = document.querySelector<HTMLTextAreaElement>('#ap-theme-css')!;
		const apply = document.querySelector<HTMLButtonElement>('.ap-pref-theme-css button[type="submit"]')!;
		const choose = (theme: string) => {
			select.value = theme;
			select.dispatchEvent(new Event('change', { bubbles: true }));
			flushSync();
		};
		const edit = (text: string) => {
			css.value = text;
			css.dispatchEvent(new Event('input', { bubbles: true }));
			flushSync();
			apply.click();
			flushSync();
		};

		choose('ferrous');
		expect(root.style.getPropertyValue('--font-mono')).toBe('"RecMonoCasual Nerd Font", "Rec Mono Casual", var(--font-mono-system)');
		expect(css.value).toContain('Recursive Sans Casual Static');
		expect(apply.disabled).toBe(true);

		// CSS that doesn't read says why, and changes nothing.
		edit('--accent: url(x);');
		expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/url\(\)/);
		expect(appearanceSettings.current.theme).toBe('ferrous');

		edit('--accent: #3cb4f2;');
		expect(appearanceSettings.current).toEqual({ mode: 'system', theme: 'custom', customCss: '--accent: #3cb4f2;' });
		expect(select.value).toBe('custom');
		expect(root.style.getPropertyValue('--accent')).toBe('#3cb4f2');
		// The previous theme's tokens go.
		expect(root.style.getPropertyValue('--font-mono')).toBe('');
		expect(JSON.parse(localStorage.getItem('apron.appearance')!).vars).toEqual([['--accent', '#3cb4f2']]);

		choose('apron');
		expect(root.style.getPropertyValue('--accent')).toBe('');
		appearanceSettings.update({ ...DEFAULT_APPEARANCE });
	});
});
