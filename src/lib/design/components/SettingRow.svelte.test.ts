// @vitest-environment jsdom
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import SettingRow from './SettingRow.svelte';

let instance: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
});

const html = (markup: string) => createRawSnippet(() => ({ render: () => markup }));

describe('SettingRow', () => {
	it('titles the row in bold, or labels its control with `for`', () => {
		instance = mount(SettingRow, { target: document.body, props: { title: 'Notifications', hint: 'Alerts on this device.', control: html('<button type="button">Switch</button>') } });
		flushSync();
		const row = document.querySelector('.ap-pref-setting')!;
		expect(row.querySelector('strong.ap-pref-setting-title')?.textContent).toBe('Notifications');
		expect(row.lastElementChild?.textContent).toBe('Switch');
		unmount(instance);
		instance = mount(SettingRow, { target: document.body, props: { title: 'Theme', for: 'theme', badge: 'Experimental' } });
		flushSync();
		const label = document.querySelector('label.ap-pref-setting-title')!;
		expect(label.getAttribute('for')).toBe('theme');
		expect(label.parentElement!.textContent?.trim()).toBe('Theme Experimental');
		expect(document.querySelector('.ap-profedit-hint')).toBeNull();
	});

	it('puts `below` under the whole row, the title and control in a row of their own', () => {
		instance = mount(SettingRow, { target: document.body, props: { title: 'Status', hint: 'Online.', hintTestid: 'status-hint', class: 'ap-status-pick', control: html('<span>Menu</span>'), below: html('<div class="answer">Answered</div>') } });
		flushSync();
		const outer = document.querySelector('.ap-status-pick')!;
		expect(outer.classList.contains('ap-pref-setting')).toBe(false);
		expect([...outer.children].map((child) => child.className)).toEqual(['ap-pref-setting-row', 'answer']);
		expect(outer.querySelector('[data-testid="status-hint"]')?.textContent).toBe('Online.');
	});
});
