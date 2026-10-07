// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NotifyPrompt from './NotifyPrompt.svelte';

let instance: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
});

function render(props: Partial<{ whenClosed: boolean; pointer: boolean; onaccept: () => void; ondecline: () => void }> = {}) {
	instance = mount(NotifyPrompt, { target: document.body, props: { from: 'Ada', room: 'General', whenClosed: true, onaccept: () => {}, ondecline: () => {}, ...props } });
	flushSync();
	return document.querySelector<HTMLElement>('[data-testid="notify-prompt"]')!;
}

const button = (name: string) => [...document.querySelectorAll('button')].find((candidate) => candidate.textContent === name)!;

describe('NotifyPrompt', () => {
	it('says who mentioned you, where, and how far notifications reach, as a labelled dialog', () => {
		const prompt = render();
		expect(prompt.getAttribute('role')).toBe('dialog');
		const title = document.getElementById(prompt.getAttribute('aria-labelledby')!);
		expect(title?.textContent).toBe('Get notified when you’re mentioned?');
		const detail = document.getElementById(prompt.getAttribute('aria-describedby')!);
		expect(detail?.textContent).toBe('Ada mentioned you in General. Apron can alert you on this device, even when it’s closed.');
	});

	it('says while it’s open where push doesn’t work, and points at Preferences only when asked', () => {
		const prompt = render({ whenClosed: false });
		expect(prompt.textContent).toContain('on this device while it’s open.');
		expect(prompt.classList.contains('ap-nudge-pointer')).toBe(false);
		expect(prompt.textContent).not.toContain('Preferences');
		unmount(instance!);
		instance = undefined;
		const pointing = render({ pointer: true });
		expect(pointing.classList.contains('ap-nudge-pointer')).toBe(true);
		expect(pointing.textContent).toContain('You can change this any time in Preferences.');
	});

	it('turns them on, or declines with Not now or Escape', () => {
		const onaccept = vi.fn();
		const ondecline = vi.fn();
		render({ onaccept, ondecline });
		button('Turn on').click();
		expect(onaccept).toHaveBeenCalledOnce();
		button('Not now').click();
		const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		button('Turn on').dispatchEvent(escape);
		expect(ondecline).toHaveBeenCalledTimes(2);
		expect(escape.defaultPrevented).toBe(true);
	});
});
