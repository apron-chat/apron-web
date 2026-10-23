// @vitest-environment jsdom
import { createRawSnippet, flushSync, mount, unmount, type Component } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Popover from './Popover.svelte';
import ProfileCard from './ProfileCard.svelte';
import ReactorsPopover from './ReactorsPopover.svelte';

let instance: ReturnType<typeof mount> | undefined;

// jsdom has no ResizeObserver, which `bind:offsetHeight` uses.
beforeEach(() => {
	vi.stubGlobal('ResizeObserver', class {
		observe(): void {}
		unobserve(): void {}
		disconnect(): void {}
	});
});

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

function render<P extends Record<string, unknown>>(C: Component<P>, props: P): HTMLElement {
	instance = mount(C, { target: document.body, props });
	flushSync();
	return document.querySelector<HTMLElement>('.ap-popover')!;
}

const text = createRawSnippet(() => ({ render: () => '<p>Hello</p>' }));

describe('Popover', () => {
	it('sits where it is placed as a popover, and along the bottom as a sheet, at its height either way', () => {
		let box = render(Popover, { mode: 'popover' as const, top: 10, left: 20, width: 300, height: 200, children: text, 'aria-label': 'Hello', 'data-testid': 'pop' });
		expect([box.style.top, box.style.left, box.style.width, box.style.height]).toEqual(['10px', '20px', '300px', '200px']);
		expect(box.getAttribute('role')).toBe('dialog');
		expect(box.getAttribute('tabindex')).toBe('-1');
		expect(box.dataset.testid).toBe('pop');
		expect(box.classList.contains('ap-popover-sheet')).toBe(false);
		unmount(instance!);
		box = render(Popover, { mode: 'sheet' as const, top: 10, left: 20, width: 300, height: 200, children: text });
		expect([box.style.top, box.style.left, box.style.width, box.style.height]).toEqual(['', '', '', '200px']);
		expect(box.classList.contains('ap-popover-sheet')).toBe(true);
	});
});

describe('ProfileCard', () => {
	const status = () => document.querySelector('[data-testid="profile-status"]');

	it('says a known status in words, an unknown one as written, and none without one (§4.5)', () => {
		render(ProfileCard, { userId: 'bo', name: 'Bo', status: 'dnd' });
		expect(status()?.textContent).toBe('Do not disturb');
		unmount(instance!);
		render(ProfileCard, { userId: 'eve', status: 'in a meeting' });
		expect(status()?.textContent).toBe('Unknown status: in a meeting');
		expect(status()?.querySelector('code')?.textContent).toBe('in a meeting');
		unmount(instance!);
		render(ProfileCard, { userId: 'cy' });
		expect(status()).toBeNull();
	});

	it('takes the status in your words when given, and is labeled by the name, else the user_id', () => {
		const box = render(ProfileCard, { userId: 'ada', you: true, status: 'invisible', statusLabel: 'Invisible · others see you as offline' });
		expect(status()?.textContent).toBe('Invisible · others see you as offline');
		expect(box.getAttribute('aria-label')).toBe('Profile of ada');
		expect(box.querySelector('.ap-profcard-you')).not.toBeNull();
	});

	it('offers only the actions it is given, and says Add to room is in flight', () => {
		const noop = () => undefined;
		let box = render(ProfileCard, { userId: 'ada', oncopyid: noop });
		expect([...box.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Copy @user_id']);
		unmount(instance!);
		box = render(ProfileCard, { userId: 'ada', onmention: noop, oncopyid: noop, onaddtoroom: noop, adding: true, note: { text: 'Nope', error: true } });
		const buttons = [...box.querySelectorAll('button')];
		expect(buttons.map((b) => b.textContent)).toEqual(['Mention', 'Copy @user_id', 'Adding…']);
		expect(buttons[2].disabled).toBe(true);
		expect(box.querySelector('[role="alert"]')?.textContent).toBe('Nope');
	});
});

describe('ReactorsPopover', () => {
	it('counts the reactions, and shows @user_id only where it is asked for, to tell people apart', () => {
		const box = render(ReactorsPopover, {
			emoji: '👍',
			reactors: [{ user_id: 'you', name: 'You', you: true }, { user_id: 'linus' }, { user_id: 'grace', name: 'grace', handle: true }]
		});
		expect(box.getAttribute('aria-label')).toBe('3 reactions with 👍');
		const rows = [...box.querySelectorAll<HTMLElement>('[data-testid="reactor"]')];
		expect(rows.map((row) => row.dataset.userId)).toEqual(['you', 'linus', 'grace']);
		expect(rows.map((row) => row.querySelector('.ap-reactors-handle')?.textContent ?? '')).toEqual(['', '', '@grace']);
		expect(rows[0].querySelector('.ap-reactors-nameline')?.textContent).toBe('You(you)');
	});
});
