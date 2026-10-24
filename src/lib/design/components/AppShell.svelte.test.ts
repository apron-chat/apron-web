// @vitest-environment jsdom
import { createRawSnippet } from 'svelte';
import { describe, expect, it } from 'vitest';
import AppShell from './AppShell.svelte';
import * as dom from '$lib/test/dom';

const markup = (html: string) => createRawSnippet(() => ({ render: () => html }));

function render(props: Record<string, unknown>) {
	dom.render(AppShell, props);
	return document.querySelector<HTMLElement>('.ap-shell')!;
}

describe('AppShell', () => {
	it('sizes the rooms column to its width, or --sidebar-w, and to nothing while shut', () => {
		let shell = render({ sideWidth: 300 });
		expect(shell.style.getPropertyValue('--side-col')).toBe('300px');
		expect(shell.style.getPropertyValue('--rooms-w')).toBe('300px');
		dom.unmount();
		shell = render({ sideWidth: 300, sideCollapsed: true });
		expect(shell.style.getPropertyValue('--side-col')).toBe('0px');
		expect(shell.style.getPropertyValue('--rooms-w')).toBe('300px');
		expect(shell.classList.contains('ap-shell-side-shut')).toBe(true);
		dom.unmount();
		// Without a width, the rooms list keeps --sidebar-w.
		shell = render({ sideCollapsed: true });
		expect(shell.style.getPropertyValue('--side-col')).toBe('0px');
		expect(shell.style.getPropertyValue('--sidebar-w')).toBe('');
		expect(shell.style.getPropertyValue('--rooms-w')).toBe('');
	});

	it('gives the member list a column only while it is wide and open', () => {
		expect(render({ membersWidth: 240, membersWide: true, membersOpen: true }).style.getPropertyValue('--member-list-track')).toBe('240px');
		dom.unmount();
		expect(render({ membersWidth: 240, membersWide: true }).style.getPropertyValue('--member-list-track')).toBe('0px');
		dom.unmount();
		expect(render({ membersWidth: 240, membersOpen: true }).style.getPropertyValue('--member-list-track')).toBe('0px');
	});

	it('renders its parts in order, the main pane in a <main> named by its label', () => {
		const shell = render({
			pane: 'rooms',
			sideToggle: markup('<button id="toggle"></button>'),
			side: markup('<aside id="side"></aside>'),
			nudge: markup('<div id="offer"></div>'),
			main: markup('<div id="pane"></div>'),
			mainLabel: 'Conversation',
			members: markup('<aside id="members"></aside>')
		});
		expect(shell.dataset.pane).toBe('rooms');
		expect(shell.classList.contains('ap-shell-norail')).toBe(true);
		expect(shell.classList.contains('ap-shell-side-toggle')).toBe(true);
		expect(shell.classList.contains('ap-shell-members-toggle')).toBe(false);
		expect([...shell.children].map((child) => child.id || child.className)).toEqual(['toggle', 'side', 'ap-shell-nudge', 'ap-shell-main', 'members']);
		const main = shell.querySelector('main')!;
		expect(main.getAttribute('aria-label')).toBe('Conversation');
		expect(main.querySelector('#pane')).not.toBeNull();
	});

	it('takes a class beside its own, and an attachment for the main pane', () => {
		const attached: Element[] = [];
		const shell = render({ pane: 'main', sideWidth: 300, class: 'mine', main: markup('<div></div>'), mainAttach: (node: Element) => { attached.push(node); } });
		expect([shell.classList.contains('ap-shell'), shell.classList.contains('mine'), shell.dataset.pane]).toEqual([true, true, 'main']);
		expect(shell.style.getPropertyValue('--rooms-w')).toBe('300px');
		const main = shell.querySelector('main')!;
		expect([main.className, attached]).toEqual(['ap-shell-main', [main]]);
	});
});
