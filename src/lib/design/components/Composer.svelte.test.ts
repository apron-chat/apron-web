// @vitest-environment jsdom
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Composer from './Composer.svelte';

let instance: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
});

const html = (markup: string) => createRawSnippet(() => ({ render: () => markup }));
const testid = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

function render(props: Record<string, unknown>) {
	instance = mount(Composer, { target: document.body, props: { room: 'Ops', ...props } });
	flushSync();
}

describe('Composer', () => {
	it('disables Send on an empty draft unless told it has something to send', () => {
		render({});
		expect((testid('send-button') as HTMLButtonElement).disabled).toBe(true);
		unmount(instance!);
		render({ canSend: true });
		expect((testid('send-button') as HTMLButtonElement).disabled).toBe(false);
	});

	it('takes your word on whether the draft is a command', () => {
		render({ value: '/kick ada', canCommand: true, command: false });
		expect(testid('command-tag')).toBeNull();
		expect(testid('send-button')?.textContent).toBe('Send');
		unmount(instance!);
		render({ value: 'plain', command: true });
		expect(testid('command-tag')).not.toBeNull();
		expect(testid('send-button')?.getAttribute('aria-label')).toBe('Run command');
	});

	it('draws an empty editable for you to fill, with your attributes and the placeholder while empty', () => {
		const onkeydown = vi.fn();
		render({ editable: true, empty: true, fieldProps: { id: 'message-input', 'data-testid': 'message-input', onkeydown } });
		const field = testid('message-input')!;
		expect(field.tagName).toBe('DIV');
		expect(field.id).toBe('message-input');
		expect(field.getAttribute('aria-label')).toBe('Message');
		expect(field.dataset.placeholder).toBe('Message Ops');
		expect(field.classList.contains('ap-composer-editable-empty')).toBe(true);
		expect(field.childNodes).toHaveLength(0);
		field.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
		expect(onkeydown).toHaveBeenCalledOnce();
	});

	it('opens a file picker for onfiles and hands over what was picked', () => {
		const onfiles = vi.fn();
		render({ canUpload: true, canRecord: false, onfiles });
		const input = testid('attach-input') as HTMLInputElement;
		const file = new File(['hi'], 'notes.txt', { type: 'text/plain' });
		Object.defineProperty(input, 'files', { value: [file], configurable: true });
		input.dispatchEvent(new Event('change', { bubbles: true }));
		expect(onfiles).toHaveBeenCalledWith([file]);
	});

	it('shows the reply, your file tiles and the link previews above the field', () => {
		const oncancelreply = vi.fn();
		const onremovepreview = vi.fn();
		render({
			reply: { name: 'Ada', text: 'raw' },
			replyText: html('<span class="mine">rendered</span>'),
			oncancelreply,
			attachments: html('<div class="ap-attachment">tile</div>'),
			previews: [{ kind: 'link', url: 'https://a.test/1' }, { kind: 'link', url: 'https://a.test/2' }],
			preview: createRawSnippet((index: () => number) => ({ render: () => `<div class="ap-embed">preview ${index()}</div>` })),
			onremovepreview
		});
		expect(testid('reply-draft')?.textContent).toContain('Replying to Ada: rendered');
		(testid('reply-draft')!.querySelector('button') as HTMLButtonElement).click();
		expect(oncancelreply).toHaveBeenCalledOnce();
		expect(testid('staged-files')?.textContent).toBe('tile');
		const previews = testid('link-previews')!;
		expect([...previews.querySelectorAll('.ap-embed')].map((node) => node.textContent)).toEqual(['preview 0', 'preview 1']);
		previews.querySelectorAll<HTMLButtonElement>('.ap-embed-remove')[1].click();
		expect(onremovepreview).toHaveBeenCalledWith(1);
	});

	it('holds Attach, the emoji button and Send while recording, and shows the emoji picker open', () => {
		render({ canUpload: true, recording: true, recordingTime: '0:07', onemoji: () => {}, emojiOpen: true, canSend: true });
		expect(document.querySelector('.ap-composer-rectime')?.textContent).toBe('0:07');
		expect(document.querySelector<HTMLButtonElement>('[aria-label="Attach a file"]')!.disabled).toBe(true);
		expect(document.querySelector<HTMLButtonElement>('[aria-label="Stop recording"]')!.disabled).toBe(false);
		const emoji = testid('emoji-button') as HTMLButtonElement;
		expect(emoji.disabled).toBe(true);
		expect(emoji.getAttribute('aria-expanded')).toBe('true');
		expect(emoji.classList.contains('ap-iconbtn-on')).toBe(true);
		expect((testid('send-button') as HTMLButtonElement).disabled).toBe(true);
	});

	it('takes the direction of what is typed, in either field, and names a blank-titled thread by its room_id', () => {
		render({ thread: { thread: 't1', name: '' } });
		const field = document.querySelector('.ap-composer-field')!;
		expect(field.getAttribute('dir')).toBe('auto');
		expect(field.getAttribute('placeholder')).toBe('Reply in t1');
		unmount(instance!);
		render({ editable: true, empty: true });
		expect(document.querySelector('.ap-composer-editable')?.getAttribute('dir')).toBe('auto');
	});
});
