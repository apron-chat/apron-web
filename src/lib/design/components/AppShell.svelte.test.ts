// @vitest-environment jsdom
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import AppShell from './AppShell.svelte';

let instance: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
});

const markup = (html: string) => createRawSnippet(() => ({ render: () => html }));

function render(props: Record<string, unknown>) {
	instance = mount(AppShell, { target: document.body, props });
	flushSync();
	return document.querySelector<HTMLElement>('.ap-shell')!;
}

describe('AppShell', () => {
	it('sizes the rooms column to its width, and to nothing while shut', () => {
		let shell = render({ sideWidth: 300 });
		expect(shell.style.getPropertyValue('--side-col')).toBe('300px');
		expect(shell.style.getPropertyValue('--rooms-w')).toBe('300px');
		unmount(instance!);
		shell = render({ sideWidth: 300, sideCollapsed: true });
		expect(shell.style.getPropertyValue('--side-col')).toBe('0px');
		expect(shell.style.getPropertyValue('--rooms-w')).toBe('300px');
		expect(shell.classList.contains('ap-shell-side-shut')).toBe(true);
	});

	it('keeps the rooms list at --sidebar-w while shut when no width is given', () => {
		const shell = render({ sideCollapsed: true });
		expect(shell.style.getPropertyValue('--side-col')).toBe('0px');
		expect(shell.style.getPropertyValue('--sidebar-w')).toBe('');
		expect(shell.style.getPropertyValue('--rooms-w')).toBe('');
	});

	it('gives the member list a column only while it is wide and open', () => {
		expect(render({ membersWidth: 240, membersWide: true, membersOpen: true }).style.getPropertyValue('--member-list-track')).toBe('240px');
		unmount(instance!);
		expect(render({ membersWidth: 240, membersWide: true }).style.getPropertyValue('--member-list-track')).toBe('0px');
		unmount(instance!);
		expect(render({ membersWidth: 240, membersOpen: true }).style.getPropertyValue('--member-list-track')).toBe('0px');
	});

	it('renders its parts in order, the main pane in a <main> with its attributes', () => {
		const shell = render({
			pane: 'rooms',
			sideToggle: markup('<button id="toggle"></button>'),
			side: markup('<aside id="side"></aside>'),
			nudge: markup('<div id="offer"></div>'),
			main: markup('<div id="pane"></div>'),
			mainAttrs: { 'aria-label': 'Conversation' },
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

	it('lets the caller’s attributes win: classes added, its style after the shell’s own', () => {
		const shell = render({
			pane: 'rooms', sideWidth: 300, class: 'mine', 'data-pane': 'main', style: '--rooms-w: 280px; color: red',
			main: markup('<div></div>'), mainAttrs: { class: 'pane' }
		});
		expect([shell.classList.contains('ap-shell'), shell.classList.contains('mine'), shell.dataset.pane]).toEqual([true, true, 'main']);
		expect([shell.style.getPropertyValue('--side-col'), shell.style.getPropertyValue('--rooms-w'), shell.style.color]).toEqual(['300px', '280px', 'red']);
		expect(shell.querySelector('main')?.className).toBe('ap-shell-main pane');
	});
});
