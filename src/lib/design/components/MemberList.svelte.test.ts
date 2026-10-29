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

	describe('a row\'s menu', () => {
		const rightClick = (target: Element, x = 40, y = 60) => {
			const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y });
			target.dispatchEvent(event);
			flushSync();
			return event;
		};
		const row = (id: string) => document.querySelector<HTMLLIElement>(`li.ap-member[data-user="${id}"]`)!;
		const who = (id: string) => row(id).querySelector<HTMLButtonElement>('.ap-member-who')!;
		const choices = () => [...dom.byRole('menu').querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);
		/** A pointer's press (`detail` 1); `element.click()` is the keyboard's (0). */
		const tap = (target: Element) => target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));

		it('drops down from anywhere on the row: Profile, Direct message, Remove from room, each doing its part', async () => {
			const onprofile = vi.fn(), onmessage = vi.fn(), onremove = vi.fn();
			render({ sections: [{ key: 'online', label: 'Online', people: [{ user_id: 'bo', name: 'Bo', status: 'online', roles: ['admin'] }] }], onprofile, onmessage, onremove });
			expect([who('bo').getAttribute('aria-haspopup'), who('bo').getAttribute('aria-expanded')]).toEqual(['menu', 'false']);
			// A badge is the row too.
			tap(row('bo').querySelector('.ap-role')!);
			flushSync();
			await tick();
			expect([choices(), who('bo').getAttribute('aria-expanded'), row('bo').classList.contains('ap-member-menu')]).toEqual([['Profile', 'Direct message', 'Remove from room'], 'true', true]);
			expect(dom.byRole('menuitem', 'Remove from room').classList.contains('ap-menu-item-danger')).toBe(true);
			dom.byRole('menuitem', 'Profile').click();
			flushSync();
			expect([onprofile.mock.calls, dom.queryByRole('menu')]).toEqual([[['bo', who('bo')]], null]);
			tap(row('bo'));
			flushSync();
			dom.byRole('menuitem', 'Direct message').click();
			tap(row('bo'));
			flushSync();
			dom.byRole('menuitem', 'Remove from room').click();
			expect([onmessage.mock.calls, onremove.mock.calls]).toEqual([[['bo']], [['bo']]]);
		});

		it('is put away by pressing the row again, or Escape, focus back on the name; from the keyboard, its first choice is focused', async () => {
			render({ sections, onprofile: vi.fn(), onremove: vi.fn() });
			tap(row('bo'));
			flushSync();
			await tick();
			expect(document.activeElement).toBe(dom.byRole('menu', 'Bo'));
			// The press that puts it away doesn't open it again.
			row('bo').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
			document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
			tap(row('bo'));
			flushSync();
			expect(dom.queryByRole('menu')).toBeNull();
			// Enter on the name, a click with no pointer.
			who('bo').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
			flushSync();
			await tick();
			expect(document.activeElement?.textContent).toBe('Profile');
			dom.press(dom.byRole('menu'), 'Escape');
			flushSync();
			expect([dom.queryByRole('menu'), document.activeElement]).toEqual([null, who('bo')]);
		});

		it('is skipped on your own row, and wherever Profile is all it would hold: pressing the row opens the card', () => {
			const onprofile = vi.fn();
			render({ sections, onprofile, onremove: vi.fn() });
			expect(who('ada').getAttribute('aria-haspopup')).toBe('dialog');
			tap(row('ada'));
			expect([onprofile.mock.calls, dom.queryByRole('menu')]).toEqual([[['ada', who('ada')]], null]);
			// Yours keeps the browser's own context menu.
			expect(rightClick(row('ada')).defaultPrevented).toBe(false);
			dom.unmount();
			render({ sections, onprofile });
			tap(row('bo'));
			expect([onprofile.mock.calls.at(-1), dom.queryByRole('menu')]).toEqual([['bo', who('bo')], null]);
		});

		it('opens the profile for a tap, the menu staying for a long press; a tap with the menu open only puts it away', () => {
			vi.useFakeTimers();
			const onprofile = vi.fn();
			render({ sections, onprofile, onremove: vi.fn() });
			const name = row('bo').querySelector('.ap-member-text')!;
			dom.touch('pointerdown', name, 30, 40);
			dom.touch('pointerup', name, 30, 40);
			tap(name);
			flushSync();
			expect([onprofile.mock.calls, dom.queryByRole('menu')]).toEqual([[['bo', who('bo')]], null]);
			dom.touch('pointerdown', name, 30, 40);
			vi.advanceTimersByTime(500);
			flushSync();
			dom.touch('pointerup', name, 30, 40);
			tap(name);
			flushSync();
			expect([onprofile.mock.calls.length, choices()]).toEqual([1, ['Profile', 'Remove from room']]);
			// With the menu open, a tap on its row only puts it away: no card.
			dom.touch('pointerdown', name, 30, 40);
			dom.touch('pointerdown', document.body);
			dispatchEvent(new MouseEvent('pointerup'));
			tap(name);
			flushSync();
			expect([onprofile.mock.calls.length, dom.queryByRole('menu')]).toEqual([1, null]);
			// A mouse's click after a finger's still drops the menu down.
			row('bo').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
			tap(name);
			flushSync();
			expect(dom.byRole('menu', 'Bo')).toBeTruthy();
			vi.useRealTimers();
		});

		it('keeps a long press going while the list is redrawn under it (presence, the minute), and opens at its end', () => {
			vi.useFakeTimers();
			const state = $state({ sections, onremove: vi.fn(), onprofile: vi.fn() });
			dom.render(MemberList, state as never);
			flushSync();
			dom.touch('pointerdown', row('bo').querySelector('.ap-member-text')!, 30, 40);
			vi.advanceTimersByTime(300);
			// The people rebuilt, as the sidebar does each minute: the same members, new objects.
			state.sections = sections.map((section) => ({ ...section, people: section.people.map((person) => ({ ...person })) }));
			flushSync();
			vi.advanceTimersByTime(200);
			flushSync();
			expect(dom.byRole('menu', 'Bo')).toBeTruthy();
			vi.useRealTimers();
		});

		it('gives focus back to the name when the row\'s press puts it away, and doesn\'t eat a tap after a press that came to nothing', async () => {
			vi.useFakeTimers();
			render({ sections, onprofile: vi.fn(), onremove: vi.fn() });
			tap(row('bo'));
			flushSync();
			row('bo').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
			document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
			tap(row('bo').querySelector('.ap-role') ?? row('bo'));
			flushSync();
			expect([dom.queryByRole('menu'), document.activeElement]).toEqual([null, who('bo')]);
			// Opened again, then a press on its row that ends without a click (a scroll): the next tap still opens it.
			tap(row('bo'));
			flushSync();
			row('bo').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
			document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
			dispatchEvent(new MouseEvent('pointercancel'));
			vi.advanceTimersByTime(0);
			tap(row('bo'));
			flushSync();
			expect(dom.byRole('menu', 'Bo')).toBeTruthy();
			vi.useRealTimers();
		});

		it('offers only Profile while a change is under way, no Direct message to a system identity, and opens from ↓ on the name', async () => {
			const onprofile = vi.fn();
			render({ sections, onprofile, onmessage: vi.fn(), onremove: vi.fn(), busy: true });
			tap(row('bo'));
			expect([onprofile.mock.calls.length, dom.queryByRole('menu')]).toEqual([1, null]);
			dom.unmount();
			render({ sections: [{ key: 'online', label: 'Online', people: [{ user_id: '~bot', name: 'Bot', system: true }] }], onprofile, onmessage: vi.fn(), onremove: vi.fn() });
			dom.press(who('~bot'), 'ArrowDown');
			flushSync();
			await tick();
			const menu = dom.byRole('menu', 'Bot');
			expect([choices(), document.activeElement?.textContent, who('~bot').getAttribute('aria-controls')]).toEqual([['Profile', 'Remove from room'], 'Profile', menu.id]);
		});

		it('opens where it was right-clicked or held, and the long press then opens no card; no Remove while one is under way', async () => {
			vi.useFakeTimers();
			const onremove = vi.fn(), onprofile = vi.fn();
			render({ sections, onremove, onprofile });
			expect(rightClick(row('bo'), 40, 60).defaultPrevented).toBe(true);
			expect([dom.byRole('menu', 'Bo').style.left, dom.byRole('menu').style.top]).toEqual(['40px', '60px']);
			dom.press(dom.byRole('menu'), 'Escape');
			const name = row('cy').querySelector('.ap-member-text')!;
			dom.touch('pointerdown', name, 30, 40);
			vi.advanceTimersByTime(500);
			flushSync();
			expect(choices()).toEqual(['Profile', 'Remove from room']);
			dom.touch('pointerup', name, 30, 40);
			tap(name);
			expect(onprofile).not.toHaveBeenCalled();
			vi.useRealTimers();
			dom.unmount();
			render({ sections, onremove, onprofile, busy: true });
			// Profile alone left: the browser's own menu, and a press opens the card.
			expect(rightClick(row('bo')).defaultPrevented).toBe(false);
			tap(row('bo'));
			expect(onprofile).toHaveBeenCalledOnce();
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
