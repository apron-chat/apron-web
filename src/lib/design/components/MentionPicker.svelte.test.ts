// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import MentionPicker from './MentionPicker.svelte';
import * as dom from '$lib/test/dom';

function render(props: Record<string, unknown>) {
	dom.render(MentionPicker, props);
	return document.querySelector<HTMLElement>('[role="listbox"]')!;
}

const rows = (list: HTMLElement) => [...list.querySelectorAll('[role="option"]')].map((row) => row.textContent?.replace(/\s+/g, ' ').trim());

describe('MentionPicker', () => {
	it('lists people, marking the query in names and IDs, with option IDs for the field', () => {
		const onpick = vi.fn();
		const list = render({ id: 'pick', query: 'Da', active: 1, onpick, people: [{ user_id: 'dana', name: 'Dana' }, { user_id: 'dave.k', name: ' Dave Kim ' }, { user_id: 'amanda' }] });
		expect(list.getAttribute('aria-label')).toBe('Mention someone');
		expect(rows(list)).toEqual(['D Dana @dana', 'DK Dave Kim @dave.k Tab', 'A amanda']);
		expect([...list.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual(['Da', 'da', 'Da', 'da', 'da']);
		expect(list.querySelectorAll('[role="option"]')[1].id).toBe('pick-1');
		list.querySelectorAll('[role="option"]')[2].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
		expect(onpick).toHaveBeenCalledWith({ user_id: 'amanda' }, 2);
	});

	it('lists roles among people, with how many each reaches, marking what follows a typed @&', () => {
		let list = render({ query: '&mo', people: [{ role: 'moderator', count: 2 }, { role: 'mod', count: 1 }] });
		expect(rows(list)).toEqual(['@moderator 2 people Tab', '@mod 1 person']);
		expect([...list.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual(['mo', 'mo']);
		dom.unmount();
		list = render({ query: 'da', people: [{ user_id: 'dana', name: 'Dana' }, { role: 'data', count: 4 }] });
		expect(rows(list)).toEqual(['D Dana @dana Tab', '@data 4 people']);
	});

	it('lists rooms or emoji instead when given them, and says what an empty list means for each kind', () => {
		let list = render({ query: 'de', rooms: [{ id: 'deploy', title: 'Deploy' }] });
		expect(list.getAttribute('aria-label')).toBe('Room suggestions');
		expect(rows(list)).toEqual(['Deploy #deploy Tab']);
		expect(list.querySelector('mark')).toBeNull();
		dom.unmount();
		list = render({ query: 'smi', emoji: [{ id: 'smile', native: '😄', name: 'Smiling Face' }] });
		expect(list.getAttribute('aria-label')).toBe('Emoji suggestions');
		expect(rows(list)).toEqual(['😄 :smile: Smiling Face Tab']);
		dom.unmount();
		// An empty list says what it means for each kind.
		expect(render({ query: '' }).textContent).toBe('People in this room');
		dom.unmount();
		expect(render({ query: 'Zed' }).textContent).toBe('No one here matches “Zed”');
		dom.unmount();
		expect(render({ query: '&zed' }).textContent).toBe('No role here matches “zed”');
		dom.unmount();
		expect(render({ query: '&' }).textContent).toBe('No one else here has a role');
		dom.unmount();
		expect(render({ query: '', rooms: [] }).textContent).toBe('No room matches “”');
		dom.unmount();
		expect(render({ query: 'zz', emoji: [] }).textContent).toBe('No emoji match “zz”');
	});
});
