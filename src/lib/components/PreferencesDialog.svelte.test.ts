// @vitest-environment jsdom
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import PreferencesDialog from './PreferencesDialog.svelte';

let instance: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
});

describe('PreferencesDialog', () => {
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
});
