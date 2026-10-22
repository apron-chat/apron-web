// @vitest-environment jsdom
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Message from './Message.svelte';

let instance: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
});

const html = (markup: string) => createRawSnippet(() => ({ render: () => markup }));
const sender = { user_id: 'ada', name: 'Ada' };

function render(props: Record<string, unknown>) {
	instance = mount(Message, { target: document.body, props: { messageId: '1', sender, timestamp: 1710000000000, ...props } });
	flushSync();
	return document.querySelector('article')!;
}

describe('Message', () => {
	it('takes your own avatar, name, quote and body in place of its own', () => {
		const row = render({
			grouped: true,
			text: 'unused',
			avatar: html('<button class="mine-avatar">A</button>'),
			name: html('<button class="ap-msg-sender">Ada</button>'),
			reply: html('<div class="ap-reply">Message unavailable</div>'),
			body: html('<div class="ap-msg-text mine-body">hi</div>')
		});
		// A quote leads into the avatar, so the reply isn't grouped even when asked to be.
		expect(row.classList.contains('ap-msg-grouped')).toBe(false);
		expect(row.querySelector('.ap-msg-reply')?.textContent).toBe('Message unavailable');
		expect(row.querySelector('.ap-msg-gutter .mine-avatar')).not.toBeNull();
		expect(row.querySelectorAll('.ap-msg-sender')).toHaveLength(1);
		expect(row.querySelector('.ap-msg-handle')).toBeNull();
		expect(row.querySelector('.ap-msg-main .ap-msg-text')?.className).toBe('ap-msg-text mine-body');
	});

	it('puts other attributes on the row, and your onclick replaces the select-mode toggle', () => {
		const onclick = vi.fn();
		const onselect = vi.fn();
		const row = render({ text: 'hi', selectMode: true, onselect, onclick, 'data-timeline-item': '' });
		expect(row.hasAttribute('data-timeline-item')).toBe(true);
		row.click();
		expect(onclick).toHaveBeenCalledOnce();
		expect(onselect).not.toHaveBeenCalled();
	});

	it('shows actions on a tombstone when you give them, and the handle when asked even if it matches the name', () => {
		const row = render({ deleted: true, sender: { user_id: 'ada', name: 'ada' }, handle: true, actions: html('<button>Remove reply</button>') });
		expect(row.querySelector('.ap-msg-tomb')).not.toBeNull();
		expect(row.querySelector('.ap-msg-actions')?.textContent).toBe('Remove reply');
		expect(row.querySelector('.ap-msg-handle')?.textContent).toBe('@ada');
	});

	it('keeps its header to the name, handle, badges and time in that order, the full name on the name for when it is cut short', () => {
		const row = render({ sender: { user_id: 'bart', name: 'Bartholomew Maximilian Featherstonehaugh-Cholmondeley', roles: ['admin', 'bot'] } });
		const head = row.querySelector('.ap-msg-head')!;
		expect([...head.children].map((part) => part.className)).toEqual(['ap-msg-sender', 'ap-msg-handle', 'ap-roles', 'ap-msg-meta']);
		expect(head.querySelector('.ap-msg-sender')?.getAttribute('title')).toBe('Bartholomew Maximilian Featherstonehaugh-Cholmondeley');
		// Every badge stays in the document, for screen readers, whether or not its row has room to show it.
		expect([...head.querySelectorAll('.ap-role')].map((badge) => badge.textContent)).toEqual(['admin', 'bot']);
	});
});
