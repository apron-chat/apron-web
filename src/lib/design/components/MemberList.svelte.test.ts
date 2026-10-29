// @vitest-environment jsdom
import { flushSync, tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import MemberList from './MemberList.svelte';
import type { MemberListSection } from './types';
import * as dom from '$lib/test/dom';
import { queryByText } from '$lib/test/queries';

function render(props: Record<string, unknown>) {
	dom.render(MemberList, props);
}

const sections: MemberListSection[] = [
	{ key: 'online', label: 'Online', people: [{ user_id: 'ada', name: 'Ada', status: 'online', you: true }, { user_id: 'bo', name: 'Bo', status: 'online' }] },
	{ key: 'offline', label: 'Offline', people: [{ user_id: 'cy', name: 'Cy', status: 'offline' }] }
];

describe('MemberList', () => {
	it('says when the count is more than it lists, a line in place of a listing, and No members listed for an empty one', () => {
		render({ room: 'General', count: 5, sections });
		expect(document.querySelector('.ap-memberlist-head')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Members 5');
		expect(queryByText('Showing 3 of 5: the most recently active')).not.toBeNull();
		expect(document.querySelector('ul')?.getAttribute('aria-label')).toBe('Online in General');
		dom.unmount();
		// A line in place of a listing, and No members listed for an empty one.
		render({ empty: 'Loading members…' });
		expect(document.querySelector('.ap-memberlist-body')?.textContent?.trim()).toBe('Loading members…');
		dom.unmount();
		render({ count: 0, sections: [] });
		expect(document.querySelector('.ap-memberlist-body')?.textContent?.trim()).toBe('No members listed.');
	});

	it('folds a section from its heading, keeping its count, but never the unheaded one', () => {
		const ontogglesection = vi.fn();
		render({ sections, shut: ['offline'], ontogglesection });
		const offline = document.querySelector<HTMLButtonElement>('[data-section="offline"] h3 button')!;
		expect(offline.getAttribute('aria-expanded')).toBe('false');
		expect(offline.textContent).toBe('Offline· 1');
		expect(document.querySelector('[data-section="offline"] ul')).toBeNull();
		offline.click();
		expect(ontogglesection).toHaveBeenCalledWith('offline');
		// Folded, its … at the heading's end unfolds it too.
		dom.button('Show all Offline').click();
		expect(ontogglesection).toHaveBeenCalledTimes(2);
		dom.unmount();
		render({ sections: [{ key: 'members', label: 'Members', people: sections[0].people }], shut: ['members'] });
		expect(document.querySelector('h3')).toBeNull();
		expect(document.querySelectorAll('li.ap-member')).toHaveLength(2);
	});

	it('marks you, isolating each name', () => {
		render({ sections });
		expect(document.querySelectorAll<HTMLLIElement>('li.ap-member')[0].textContent).toContain('(you)');
		dom.unmount();
		// Each name is isolated, so one written right to left can't carry the handle or (you) across it.
		render({ sections: [{ key: 'members', label: 'Members', people: [{ user_id: 'mo', name: 'محمد', you: true }] }] });
		const name = document.querySelector('.ap-member-name')!;
		expect(name.querySelector('bdi')?.textContent).toBe('محمد');
		expect(name.textContent).toBe('محمد(you)');
	});

	it('opens a card from anywhere on its row, anchored on the name', () => {
		const onprofile = vi.fn();
		render({ sections: [{ key: 'online', label: 'Online', people: [{ user_id: 'bo', name: 'Bo', status: 'online', roles: ['admin'] }] }], onprofile });
		const row = document.querySelector<HTMLLIElement>('li.ap-member')!;
		const who = row.querySelector<HTMLButtonElement>('.ap-member-who')!;
		row.click();
		row.querySelector<HTMLElement>('.ap-role')!.click();
		expect(onprofile.mock.calls).toEqual([['bo', who], ['bo', who]]);
	});

	describe('a row\'s menu', () => {
		const rightClick = (target: Element, x = 40, y = 60) => {
			const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y });
			target.dispatchEvent(event);
			flushSync();
			return event;
		};
		const row = (id: string) => document.querySelector<HTMLLIElement>(`li.ap-member[data-user="${id}"]`)!;

		it('offers Remove from room on everyone but you, from a right-click, focused, and gives focus back as it goes', async () => {
			const onremove = vi.fn(), onprofile = vi.fn();
			render({ sections, onremove, onprofile });
			// Yours has nothing in it: the browser's own menu stays.
			expect([rightClick(row('ada')).defaultPrevented, dom.queryByRole('menu')]).toEqual([false, null]);
			expect(rightClick(row('bo')).defaultPrevented).toBe(true);
			await tick();
			const menu = dom.byRole('menu', 'Bo');
			expect([...menu.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toEqual(['Remove from room']);
			expect(document.activeElement).toBe(menu);
			expect(row('bo').classList.contains('ap-member-menu')).toBe(true);
			dom.press(menu, 'Escape');
			flushSync();
			expect([dom.queryByRole('menu'), document.activeElement]).toEqual([null, row('bo').querySelector('.ap-member-who')]);
			rightClick(row('cy'));
			await tick();
			dom.byRole('menuitem', 'Remove from room').click();
			flushSync();
			expect([onremove.mock.calls, onprofile.mock.calls.length, dom.queryByRole('menu')]).toEqual([[['cy']], 0, null]);
		});

		it('opens from a long touch press too, and the press then opens no card; not while a remove is under way', async () => {
			vi.useFakeTimers();
			const onremove = vi.fn(), onprofile = vi.fn();
			render({ sections, onremove, onprofile });
			const name = row('bo').querySelector('.ap-member-text')!;
			dom.touch('pointerdown', name, 30, 40);
			vi.advanceTimersByTime(500);
			flushSync();
			expect(dom.byRole('menu', 'Bo')).toBeTruthy();
			dom.touch('pointerup', name, 30, 40);
			(name as HTMLElement).click();
			expect(onprofile).not.toHaveBeenCalled();
			// A short tap is still a tap.
			dom.press(dom.byRole('menu'), 'Escape');
			dom.touch('pointerdown', name, 30, 40);
			vi.advanceTimersByTime(200);
			dom.touch('pointerup', name, 30, 40);
			(name as HTMLElement).click();
			expect(onprofile).toHaveBeenCalledOnce();
			vi.useRealTimers();
			dom.unmount();
			render({ sections, onremove, onprofile, busy: true });
			expect(rightClick(row('bo')).defaultPrevented).toBe(false);
			expect(dom.queryByRole('menu')).toBeNull();
		});
	});

	it('dims offline members only, saying each status in words on hover and to a screen reader; an unknown one is not offline (§4.5)', () => {
		render({ sections: [{ key: 'online', label: 'Online', people: [{ user_id: 'bo', name: 'Bo', status: 'online' }, { user_id: 'eve', name: 'Eve', status: 'brb' }, { user_id: 'cy', name: 'Cy' }] }, sections[1]] });
		const rows = [...document.querySelectorAll<HTMLLIElement>('li.ap-member')];
		expect(rows.map((row) => [row.dataset.user, row.dataset.status ?? '', row.classList.contains('ap-member-offline')])).toEqual([
			['bo', 'online', false], ['eve', 'unknown', false], ['cy', '', false], ['cy', 'offline', true]
		]);
		expect(rows.map((row) => row.querySelector('button')!.title)).toEqual(['@bo · Online', '@eve · Unknown status: brb', '@cy', '@cy · Offline']);
		expect(rows.map((row) => row.querySelector('.ap-sr')?.textContent ?? '')).toEqual([', online', ', unknown status: brb', '', ', offline']);
		expect(rows.map((row) => row.querySelector('.ap-presence') !== null)).toEqual([true, true, false, true]);
		dom.unmount();
		// Only the first word is lowered, as it follows a comma: a date, or a value as the server sent it, reads as it is.
		render({ sections: [{ key: 'offline', label: 'Offline', people: [
			{ user_id: 'di', name: 'Di', status: 'offline', statusLabel: 'Offline · last seen Dec 1, 2025' }, { user_id: 'fy', name: 'Fy', status: 'BRB' }
		] }] });
		expect([...document.querySelectorAll('li.ap-member .ap-sr')].map((sr) => sr.textContent)).toEqual([', offline · last seen Dec 1, 2025', ', unknown status: BRB']);
	});

	it('offers Add member only with a listing, as a + that opens a dialog', () => {
		const onadd = vi.fn();
		render({ sections, onadd });
		const add = dom.button('Add member');
		expect(add.getAttribute('aria-haspopup')).toBe('dialog');
		add.click();
		expect(onadd).toHaveBeenCalledOnce();
		dom.unmount();
		render({ empty: 'Loading members…', onadd });
		expect(dom.queryByRole('button', 'Add member')).toBeNull();
	});
});
