// @vitest-environment jsdom
import { createRawSnippet } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import Composer from './Composer.svelte';
import ComposerEditable from './ComposerEditable.svelte';
import * as dom from '$lib/test/dom';
import { queryByText } from '$lib/test/queries';

function render(props: Record<string, unknown>, component: typeof Composer | typeof ComposerEditable = Composer) {
	dom.render(component, component === Composer ? { room: 'Ops', ...props } : props);
}

const send = () => dom.queryByRole<HTMLButtonElement>('button', /^(Send message|Run command)$/)!;
/** The Command tag a command draft shows. */
const commandTag = () => queryByText('Command');

describe('Composer', () => {
	it('disables Send on an empty draft unless told it has something to send, or it has files', () => {
		render({});
		expect(send().disabled).toBe(true);
		dom.unmount();
		render({ canSend: true });
		expect(send().disabled).toBe(false);
		dom.unmount();
		render({ attachments: dom.html('<div class="ap-attachment">tile</div>') });
		expect(send().disabled).toBe(false);
		dom.unmount();
		render({ value: 'hi', canSend: false });
		expect(send().disabled).toBe(true);
	});

	it('reads a draft starting with one "/" as a command, where the server takes commands', () => {
		render({ value: '/kick ada', canCommand: true });
		expect(commandTag()).not.toBeNull();
		expect([send().getAttribute('aria-label'), send().textContent]).toEqual(['Run command', 'Run']);
		expect(dom.queryByRole('textbox', 'Command')).not.toBeNull();
		dom.unmount();
		render({ value: '//kick ada', canCommand: true });
		expect(commandTag()).toBeNull();
		expect([send().getAttribute('aria-label'), send().textContent]).toEqual(['Send message', 'Send']);
		dom.unmount();
		render({ value: '/kick ada' });
		expect(commandTag()).toBeNull();
	});

	it('puts your class on its textarea, beside its own', () => {
		render({ class: 'mine' });
		const field = dom.byRole('textbox', 'Message');
		expect(field.tagName).toBe('TEXTAREA');
		expect([...field.classList]).toEqual(['ap-composer-field', 'mine']);
	});

	it('draws your own field in place of the textarea, with its placeholder and state, or an empty editable for you to fill, with your attributes', () => {
		const field = createRawSnippet((state: () => { placeholder: string; disabled: boolean; command: boolean }) => ({
			render: () => `<div class="mine" data-placeholder="${state().placeholder}" data-disabled="${state().disabled}" data-command="${state().command}"></div>`
		}));
		render({ field, value: '/me', canCommand: true, disabled: true });
		expect(document.querySelector('textarea')).toBeNull();
		const mine = document.querySelector<HTMLElement>('.mine')!;
		expect(mine.dataset).toMatchObject({ placeholder: 'Message Ops', disabled: 'true', command: 'true' });
		dom.unmount();
		// Or an empty editable for you to fill, with your attributes and the placeholder while empty.
		const onkeydown = vi.fn();
		render({ placeholder: 'Message Ops', empty: true, id: 'message-input', 'data-testid': 'message-input', class: 'mine', onkeydown }, ComposerEditable);
		const editable = dom.byRole('textbox', 'Message');
		expect(editable.classList.contains('mine')).toBe(true);
		expect(editable.tagName).toBe('DIV');
		expect(editable.id).toBe('message-input');
		expect(editable.dataset.testid).toBe('message-input');
		expect(editable.dataset.placeholder).toBe('Message Ops');
		expect(editable.classList.contains('ap-composer-editable-empty')).toBe(true);
		expect(editable.childNodes).toHaveLength(0);
		editable.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
		expect(onkeydown).toHaveBeenCalledOnce();
	});

	it('opens a file picker for onfiles and hands over what was picked', () => {
		const onfiles = vi.fn();
		render({ canUpload: true, canRecord: false, onfiles });
		const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
		expect(dom.button('Attach a file').disabled).toBe(false);
		const opened = vi.spyOn(input, 'click');
		dom.button('Attach a file').click();
		expect(opened).toHaveBeenCalledOnce();
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
			replyText: dom.html('<span class="mine">rendered</span>'),
			oncancelreply,
			attachments: dom.html('<div class="ap-attachment">tile</div>'),
			previews: [{ kind: 'link', url: 'https://a.test/1' }, { kind: 'link', url: 'https://a.test/2' }],
			preview: createRawSnippet((index: () => number) => ({ render: () => `<div class="ap-embed">preview ${index()}</div>` })),
			onremovepreview
		});
		expect(dom.byRole('status', /^Replying to Ada/).textContent).toContain('Replying to Ada: rendered');
		dom.button('Cancel reply').click();
		expect(oncancelreply).toHaveBeenCalledOnce();
		expect(document.querySelector('[aria-label="Files to send"]')?.textContent).toBe('tile');
		const previews = document.querySelector('[aria-label="Link previews to send"]')!;
		expect([...previews.querySelectorAll('.ap-embed')].map((node) => node.textContent)).toEqual(['preview 0', 'preview 1']);
		[...previews.querySelectorAll('button')].filter((button) => button.getAttribute('aria-label') === 'Remove preview')[1].click();
		expect(onremovepreview).toHaveBeenCalledWith(1);
	});

	it('holds Attach, the emoji button and Send while recording, and shows the emoji picker open', () => {
		render({ canUpload: true, recording: true, recordingTime: '0:07', onemoji: () => {}, emojiOpen: true, canSend: true });
		expect(dom.byRole('status').textContent).toBe('Recording 0:07');
		expect(dom.button('Attach a file').disabled).toBe(true);
		expect(dom.button('Stop recording').disabled).toBe(false);
		const emoji = dom.button('Insert emoji');
		expect(emoji.disabled).toBe(true);
		expect(emoji.getAttribute('aria-expanded')).toBe('true');
		expect(emoji.classList.contains('ap-iconbtn-on')).toBe(true);
		expect(send().disabled).toBe(true);
	});

	it('takes the direction of what is typed, in either field, and names the thread a reply goes to', () => {
		render({ thread: { thread: 't1', name: 'Deploy' } });
		const field = dom.byRole('textbox', 'Message');
		expect(field.getAttribute('dir')).toBe('auto');
		expect(field.getAttribute('placeholder')).toBe('Reply in Deploy');
		dom.unmount();
		render({ empty: true }, ComposerEditable);
		expect(dom.byRole('textbox', 'Message').getAttribute('dir')).toBe('auto');
	});
});
