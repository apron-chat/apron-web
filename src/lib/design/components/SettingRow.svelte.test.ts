// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import SettingRow from './SettingRow.svelte';
import { html, render, unmount } from '$lib/test/dom';

describe('SettingRow', () => {
	it('titles the row in bold, or labels its control with `for`', () => {
		render(SettingRow, { title: 'Notifications', hint: 'Alerts on this device.', control: html('<button type="button">Switch</button>') });
		const row = document.querySelector('.ap-pref-setting')!;
		expect(row.querySelector('strong.ap-pref-setting-title')?.textContent).toBe('Notifications');
		expect(row.lastElementChild?.textContent).toBe('Switch');
		unmount();
		render(SettingRow, { title: 'Theme', for: 'theme', badge: 'Experimental' });
		const label = document.querySelector('label.ap-pref-setting-title')!;
		expect(label.getAttribute('for')).toBe('theme');
		expect(label.parentElement!.textContent?.trim()).toBe('Theme Experimental');
		expect(document.querySelector('.ap-profedit-hint')).toBeNull();
	});

	it('puts `below` under the whole row, the title and control in a row of their own', () => {
		render(SettingRow, { title: 'Status', hint: 'Online.', class: 'ap-status-pick', control: html('<span>Menu</span>'), below: html('<div class="answer">Answered</div>') });
		const outer = document.querySelector('.ap-status-pick')!;
		expect(outer.classList.contains('ap-pref-setting')).toBe(false);
		expect([...outer.children].map((child) => child.className)).toEqual(['ap-pref-setting-row', 'answer']);
		expect(outer.firstElementChild?.textContent).toContain('Online.');
	});
});
