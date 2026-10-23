// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import Message from './Message.svelte';
import * as dom from '$lib/test/dom';

const sender = { user_id: 'ada', name: 'Ada' };

function render(props: Record<string, unknown>) {
	dom.render(Message, { messageId: '1', sender, timestamp: 1710000000000, ...props });
	return document.querySelector('article')!;
}

describe('Message', () => {
	it('takes your own avatar, name, quote and body in place of its own', () => {
		const row = render({
			grouped: true,
			text: 'unused',
			avatar: dom.html('<button class="mine-avatar">A</button>'),
			name: dom.html('<button class="ap-msg-sender">Ada</button>'),
			reply: dom.html('<div class="ap-reply">Message unavailable</div>'),
			body: dom.html('<div class="ap-msg-text mine-body">hi</div>')
		});
		// A quote leads into the avatar, so the reply isn't grouped even when asked to be.
		expect(row.classList.contains('ap-msg-grouped')).toBe(false);
		expect(row.querySelector('.ap-msg-reply')?.textContent).toBe('Message unavailable');
		expect(row.querySelector('.ap-msg-gutter .mine-avatar')).not.toBeNull();
		expect(row.querySelectorAll('.ap-msg-sender')).toHaveLength(1);
		expect(row.querySelector('.ap-msg-handle')).toBeNull();
		expect(row.querySelector('.ap-msg-main .ap-msg-text')?.className).toBe('ap-msg-text mine-body');
	});

	it('puts other attributes on the row, and runs your onclick before the select-mode toggle, which it replaces by preventing its default', () => {
		const onclick = vi.fn((event: MouseEvent) => event.preventDefault());
		const onselect = vi.fn();
		const row = render({ text: 'hi', selectMode: true, onselect, onclick, 'data-timeline-item': '', class: 'mine' });
		expect(row.hasAttribute('data-timeline-item')).toBe(true);
		expect(row.classList.contains('ap-msg')).toBe(true);
		expect(row.classList.contains('mine')).toBe(true);
		row.click();
		expect(onclick).toHaveBeenCalledOnce();
		expect(onselect).not.toHaveBeenCalled();
		dom.unmount();
		// One that lets the click through runs before the toggle.
		const calls: string[] = [];
		render({ text: 'hi', selectMode: true, onselect: () => calls.push('select'), onclick: () => calls.push('yours') }).click();
		expect(calls).toEqual(['yours', 'select']);
	});

	it('lets your onclick switch select mode on without that same click toggling the row back off', () => {
		// A shift-click: your handler starts select mode with this message picked, as the app does.
		const props = $state<Record<string, unknown>>({ messageId: '1', sender, timestamp: 1710000000000, text: 'hi', selectMode: false });
		const onselect = vi.fn();
		props.onselect = onselect;
		props.onclick = () => { props.selectMode = true; };
		dom.render(Message, props);
		document.querySelector('article')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }));
		flushSync();
		expect(props.selectMode).toBe(true);
		expect(onselect).not.toHaveBeenCalled();
		// The next click, made in select mode, toggles as usual.
		document.querySelector('article')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		expect(onselect).toHaveBeenCalledOnce();
	});

	it('shows actions on a tombstone when you give them, and the handle only when asked, even if it matches the name', () => {
		const row = render({ deleted: true, sender: { user_id: 'ada', name: 'ada' }, handle: true, actions: dom.html('<button>Remove reply</button>') });
		expect(row.querySelector('.ap-msg-tomb')).not.toBeNull();
		expect(row.querySelector('.ap-msg-actions')?.textContent).toBe('Remove reply');
		expect(row.querySelector('.ap-msg-handle')?.textContent).toBe('@ada');
		dom.unmount();
		// None by default, though it differs from the name: only where it tells people apart.
		expect(render({ sender: { user_id: 'bart', name: 'Bart' }, text: 'hi' }).querySelector('.ap-msg-handle')).toBeNull();
		dom.unmount();
		expect(render({ density: 'compact', sender: { user_id: 'bart', name: 'Bart' }, text: 'hi' }).querySelector('.ap-msg-handle')).toBeNull();
	});

	it('keeps its header to the name, handle, badges and time in that order, the full name on the name for when it is cut short', () => {
		const row = render({ sender: { user_id: 'bart', name: 'Bartholomew Maximilian Featherstonehaugh-Cholmondeley', roles: ['admin', 'bot'] }, handle: true });
		const head = row.querySelector('.ap-msg-head')!;
		expect([...head.children].map((part) => part.className)).toEqual(['ap-msg-sender', 'ap-msg-handle', 'ap-roles', 'ap-msg-meta']);
		expect(head.querySelector('.ap-msg-sender')?.getAttribute('title')).toBe('Bartholomew Maximilian Featherstonehaugh-Cholmondeley');
		// Every badge stays in the document, for screen readers, whether or not its row has room to show it.
		expect([...head.querySelectorAll('.ap-role')].map((badge) => badge.textContent)).toEqual(['admin', 'bot']);
	});
});
