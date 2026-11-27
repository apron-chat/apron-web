// @vitest-environment jsdom
import { tick } from 'svelte';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import NewThreadDialog from './NewThreadDialog.svelte';
import * as dom from '$lib/test/dom';

beforeAll(dom.stubDialog);

function field<T extends HTMLElement>(selector: string): T {
	return document.querySelector<T>(selector)!;
}

describe('NewThreadDialog', () => {
	type Props = { room?: { id: string; title: string; private?: boolean }; title?: string; description?: string; replyTo?: string; moving?: number; people?: { id: string; name?: string }[] };
	function render(props: Props = {}, oncreate = vi.fn((_thread: { title: string; description?: string }, _first?: { text: string; mentions: string[] }) => Promise.resolve())) {
		const onclose = vi.fn();
		dom.render(NewThreadDialog, { room: { id: 'ops', title: 'ops' }, enabled: true, oncreate, onclose, ...props });
		return { oncreate, onclose };
	}
	const text = () => field('dialog').textContent ?? '';
	const submitLabel = () => field('dialog button[type="submit"]').textContent;

	const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('dialog .ap-dialog-foot button')].find((b) => b.textContent?.trim() === label);

	it('starts from a message: its first line as the title, selected, and the message quoted behind "Add description", its mentions as chips', async () => {
		const { oncreate, onclose } = render({ title: 'Deploy failed', description: '> Deploy failed\n>\n> @ada says the runner looked fine.', people: [{ id: 'ada', name: 'Ada Lovelace' }] });
		const dialog = field<HTMLDialogElement>('dialog');
		expect(dialog.open).toBe(true);
		expect(text()).toContain('Start thread');
		expect(text()).toContain('In ops');
		await tick();
		const input = field<HTMLInputElement>('input.ap-field');
		expect(document.activeElement).toBe(input);
		expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'Deploy failed'.length]);
		// Put away, so it isn't taken for the first message.
		expect(document.querySelector('[data-testid="description-input"]')).toBeNull();
		button('Add description')!.click();
		await tick();
		await tick();
		const description = field('[data-testid="description-input"]');
		expect(description.querySelector('[data-user-id="ada"]')?.textContent).toContain('Ada Lovelace');
		dom.type(input, '  Why the 4pm deploy failed ');
		await dom.submit();
		// Sent as it was written: the chip is its `@ada`.
		expect(oncreate).toHaveBeenCalledWith({ title: 'Why the 4pm deploy failed', description: '> Deploy failed\n>\n> @ada says the runner looked fine.' }, undefined);
		expect(onclose).toHaveBeenCalled();
	});

	it('sends no description suggested from a message unless it was shown', async () => {
		const { oncreate } = render({ title: 'Deploy failed', description: '> Deploy failed' });
		await dom.submit();
		expect(oncreate).toHaveBeenCalledWith({ title: 'Deploy failed' }, undefined);
	});

	it('offers a first message ahead of the description, and sends what is written in it', async () => {
		const { oncreate } = render({ title: 'Deploy failed', people: [{ id: 'ada', name: 'Ada Lovelace' }] });
		await tick();
		const labels = [...document.querySelectorAll('dialog .ap-dialog-foot button')].map((b) => b.textContent?.trim());
		expect(labels.indexOf('Add first message')).toBeLessThan(labels.indexOf('Add description'));
		expect(document.querySelector('[data-testid="first-message-input"]')).toBeNull();
		button('Add first message')!.click();
		await tick();
		await tick();
		const message = field('[data-testid="first-message-input"]');
		expect(document.activeElement).toBe(message);
		expect(message.getAttribute('aria-label')).toBe('First message');
		expect(button('Add first message')).toBeUndefined();
		expect(button('Add description')).toBeDefined();
		message.textContent = '  Can you look?  ';
		message.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();
		await dom.submit();
		// Who it mentions is checked in a browser (e2e/threads.spec.ts), where its chips can be typed.
		expect(oncreate).toHaveBeenCalledWith({ title: 'Deploy failed' }, { text: 'Can you look?', mentions: [] });
	});

	it('started on a message, offers the first message as a reply to who wrote it', async () => {
		render({ title: 'Deploy failed', replyTo: 'Ada Lovelace' });
		expect(button('Add first message')).toBeUndefined();
		button('Add reply')!.click();
		await tick();
		await tick();
		const reply = field('[data-testid="first-message-input"]');
		expect(document.activeElement).toBe(reply);
		expect(reply.getAttribute('aria-label')).toBe('Reply');
		expect(text()).toContain('Reply to Ada Lovelace');
		expect(button('Add reply')).toBeUndefined();
	});

	it('offers no first message when moving messages, which start the thread', () => {
		render({ title: 'Offer', moving: 2 });
		expect(button('Add first message')).toBeUndefined();
		expect(button('Add description')).toBeDefined();
	});

	it('starts from a room with nothing filled in, needs a title, and stays open with the reason when creating fails', async () => {
		const { oncreate } = render();
		expect(field<HTMLInputElement>('input.ap-field').value).toBe('');
		expect(field<HTMLInputElement>('input.ap-field').placeholder).toBe('What it’s about');
		await dom.submit();
		expect(oncreate).not.toHaveBeenCalled();
		expect(document.querySelector('[role="alert"]')?.textContent).toBe('Enter a thread title.');
		dom.type(field('input.ap-field'), 'Office move');
		await dom.submit();
		// An empty description sends no description.
		expect(oncreate).toHaveBeenCalledWith({ title: 'Office move' }, undefined);
		dom.unmount();
		// Creating fails: it stays open with the reason.
		const { onclose } = render({ title: 'Deploy' }, vi.fn(() => Promise.reject(new Error('Not allowed'))));
		await dom.submit();
		expect(document.querySelector('[role="alert"]')?.textContent).toBe('Not allowed');
		expect(field<HTMLDialogElement>('dialog').open).toBe(true);
		expect(onclose).not.toHaveBeenCalled();
	});

	it('says what starting from a selection moves, and that a private room’s thread is private', () => {
		render({ room: { id: 'hr', title: 'Hiring', private: true }, title: 'Offer', moving: 3 });
		expect(text()).toContain('Move to a new thread');
		expect(text()).toContain('The 3 selected messages move into the new thread.');
		expect(text()).toContain('Private, like its room');
		expect(submitLabel()).toBe('Move 3 messages');
	});

	it('keeps an empty description behind "Add description", which shows the field and focuses it', async () => {
		const { oncreate } = render({ title: 'Office move' });
		await tick(); // the title takes focus first
		expect(document.querySelector('[data-testid="description-input"]')).toBeNull();
		button('Add description')!.click();
		await tick();
		await tick();
		const description = field('[data-testid="description-input"]');
		expect(document.activeElement).toBe(description);
		expect([...document.querySelectorAll('dialog button')].some((b) => b.textContent?.trim() === 'Add description')).toBe(false);
		await dom.submit();
		expect(oncreate).toHaveBeenCalledWith({ title: 'Office move' }, undefined);
	});
});
