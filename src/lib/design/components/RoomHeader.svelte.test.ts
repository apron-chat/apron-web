// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import RoomHeader from './RoomHeader.svelte';
import * as dom from '$lib/test/dom';

function render(props: Record<string, unknown>) {
	dom.render(RoomHeader, { room: 'ops', name: 'Ops', ...props });
	return document.querySelector('header')!;
}

const sub = () => [...document.querySelectorAll('.ap-roomhead-text .ap-roomhead-sub')].map((line) => line.textContent);

describe('RoomHeader', () => {
	it('says who’s typing, else a thread’s replies, else the topic', () => {
		render({ topic: 'Deploys', topicTitle: 'Deploys and incidents', typing: ['Alice'], replies: { count: 3 } });
		expect(sub()).toEqual(['Alice is typing…']);
		dom.unmount();
		render({ topic: 'Deploys', replies: { count: 12, more: true } });
		expect(sub()).toEqual(['12+ replies']);
		dom.unmount();
		render({ topic: 'Deploys', replies: { count: 1 } });
		expect(sub()).toEqual(['1 reply']);
		dom.unmount();
		render({ topic: 'Deploys', topicTitle: 'Deploys and incidents', topicTestid: 'room-description' });
		expect(document.querySelector('[data-testid="room-description"]')?.getAttribute('title')).toBe('Deploys and incidents');
	});

	it('puts Edit and Leave in a ⋯ menu named for the room or thread, and Join and the member list beside it', () => {
		const onjoin = vi.fn();
		render({ thread: 'deploy', threadName: 'Deploy', onedit: () => {}, onleave: () => {}, canJoin: true, onjoin, onmemberlist: () => {}, memberListOpen: true, busy: true, actionsTestid: 'room-actions', joinTestid: 'join-room' });
		const menu = document.querySelector<HTMLButtonElement>('[data-testid="room-actions"]')!;
		expect(menu.getAttribute('aria-label')).toBe('Thread actions');
		expect(menu.disabled).toBe(true);
		const join = document.querySelector<HTMLButtonElement>('[data-testid="join-room"]')!;
		expect([join.getAttribute('aria-label'), join.disabled]).toEqual(['Join thread', true]);
		const members = document.querySelector('.ap-roomhead-members')!;
		expect([members.getAttribute('aria-label'), members.classList.contains('ap-iconbtn-on')]).toEqual(['Hide member list', true]);
		expect(document.querySelector('.ap-roomhead-crumb')?.getAttribute('aria-label')).toBe('Back to room');
		dom.unmount();
		render({ onjoin, actionsTestid: 'room-actions', joinTestid: 'join-room' });
		// Join shows only where it's offered (`canJoin`), not wherever there's an `onjoin`.
		expect(document.querySelector('[data-testid="room-actions"], [data-testid="join-room"], .ap-roomhead-members, .ap-roomhead-back')).toBeNull();
	});

	it('lets the caller’s attributes go on the header, its class added', () => {
		const header = render({ class: 'mine', private: true, 'data-testid': 'room-header' });
		expect([header.dataset.testid, header.classList.contains('ap-roomhead'), header.classList.contains('ap-roomhead-private'), header.classList.contains('mine')]).toEqual(['room-header', true, true, true]);
	});

	it('names a blank-titled room by its room_id and calls a blank-titled thread Untitled, its room_id on hover, and isolates who is typing', () => {
		render({ name: ' ', thread: 't1', threadName: '', onroom: vi.fn() });
		expect(document.querySelector('.ap-roomhead-crumb')?.textContent).toBe('ops');
		expect(document.querySelector('h1 bdi')?.textContent).toBe('Untitled');
		expect(document.querySelector('h1 bdi')?.getAttribute('title')).toBe('t1');
		dom.unmount();
		render({ thread: 't1', threadName: 'Deploy', onroom: vi.fn() });
		expect(document.querySelector('h1 bdi')?.hasAttribute('title')).toBe(false);
		dom.unmount();
		render({ typing: ['محمد'] });
		expect(document.querySelector('.ap-roomhead-typing bdi')?.textContent).toBe('محمد');
		expect(sub()).toEqual(['محمد is typing…']);
	});
});
