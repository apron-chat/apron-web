// @vitest-environment jsdom
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AddMemberForm from './AddMemberForm.svelte';
import MemberList from './MemberList.svelte';
import type { MemberListSection } from './types';

let instance: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
});

function render(props: Record<string, unknown>) {
	instance = mount(MemberList, { target: document.body, props });
	flushSync();
}

const sections: MemberListSection[] = [
	{ key: 'online', label: 'Online', people: [{ user_id: 'ada', name: 'Ada', status: 'online', you: true }, { user_id: 'bo', name: 'Bo', status: 'online' }] },
	{ key: 'offline', label: 'Offline', people: [{ user_id: 'cy', name: 'Cy', status: 'offline' }] }
];

describe('MemberList', () => {
	it('says when the count is more than it lists', () => {
		render({ room: 'General', count: 5, sections, countTestid: 'member-count', truncatedTestid: 'member-list-truncated' });
		expect(document.querySelector('[data-testid="member-count"]')?.textContent).toBe('5');
		expect(document.querySelector('[data-testid="member-list-truncated"]')?.textContent).toBe('Showing 3 of 5: the most recently active');
		expect(document.querySelector('ul')?.getAttribute('aria-label')).toBe('Online in General');
	});

	it('shows a line in place of a listing, and No members listed for an empty one', () => {
		render({ empty: 'Loading members…' });
		expect(document.querySelector('.ap-memberlist-body')?.textContent?.trim()).toBe('Loading members…');
		unmount(instance!);
		render({ count: 0, sections: [] });
		expect(document.querySelector('.ap-memberlist-body')?.textContent?.trim()).toBe('No members listed.');
	});

	it('folds a section from its heading, keeping its count, but never the unheaded one', () => {
		const ontogglesection = vi.fn();
		render({ sections, shut: ['offline'], ontogglesection });
		const offline = document.querySelector<HTMLButtonElement>('[data-section="offline"] h3 button')!;
		expect(offline.getAttribute('aria-expanded')).toBe('false');
		expect(offline.textContent).toBe('▾Offline· 1');
		expect(document.querySelector('[data-section="offline"] ul')).toBeNull();
		offline.click();
		expect(ontogglesection).toHaveBeenCalledWith('offline');
		unmount(instance!);
		render({ sections: [{ key: 'members', label: 'Members', people: sections[0].people }], shut: ['members'] });
		expect(document.querySelector('h3')).toBeNull();
		expect(document.querySelectorAll('li.ap-member')).toHaveLength(2);
	});

	it('dims offline members and offers removing everyone but you', () => {
		const onremove = vi.fn();
		render({ sections, onremove });
		const rows = [...document.querySelectorAll<HTMLLIElement>('li.ap-member')];
		expect(rows.map((row) => row.classList.contains('ap-member-offline'))).toEqual([false, false, true]);
		expect(rows.map((row) => row.querySelector('.ap-member-remove') !== null)).toEqual([false, true, true]);
		expect(rows[0].textContent).toContain('(you)');
		rows[1].querySelector<HTMLButtonElement>('.ap-member-remove')!.click();
		expect(onremove).toHaveBeenCalledWith('bo');
	});

	it('offers the add form only with a listing, and sends what was typed', () => {
		const onadd = vi.fn();
		/** The add form as MemberList's `addForm`: an AddMemberForm given the id its + controls. */
		const addForm = (props: Record<string, unknown>) => createRawSnippet((id: () => string) => ({
			render: () => '<div></div>',
			setup(el) {
				const form = mount(AddMemberForm, { target: el, props: { id: id(), ...props } });
				return () => unmount(form);
			}
		}));
		render({ sections, onaddtoggle: () => {}, addOpen: true, addForm: addForm({ value: 'cy', onadd }) });
		const toggle = document.querySelector<HTMLButtonElement>('.ap-memberlist-addtoggle')!;
		const form = document.querySelector<HTMLFormElement>('form.ap-memberlist-add')!;
		expect(toggle.getAttribute('aria-controls')).toBe(form.id);
		form.dispatchEvent(new SubmitEvent('submit', { cancelable: true }));
		expect(onadd).toHaveBeenCalledWith('cy');
		unmount(instance!);
		render({ empty: 'Loading members…', onaddtoggle: () => {}, addOpen: true, addForm: addForm({}) });
		expect(document.querySelector('.ap-memberlist-addtoggle')).toBeNull();
		expect(document.querySelector('form')).toBeNull();
	});

	it('isolates each name, so one written right to left can’t carry the handle or (you) across it', () => {
		render({ sections: [{ key: 'members', label: 'Members', people: [{ user_id: 'mo', name: 'محمد', you: true }] }] });
		const name = document.querySelector('.ap-member-name')!;
		expect(name.querySelector('bdi')?.textContent).toBe('محمد');
		expect(name.textContent).toBe('محمد(you)');
	});
});
