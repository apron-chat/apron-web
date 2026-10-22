// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RoomHeader from './RoomHeader.svelte';

let instance: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
});

function render(props: Record<string, unknown>) {
	instance = mount(RoomHeader, { target: document.body, props: { room: 'ops', name: 'Ops', ...props } });
	flushSync();
	return document.querySelector('header')!;
}

const sub = () => [...document.querySelectorAll('.ap-roomhead-text .ap-roomhead-sub')].map((line) => line.textContent);

describe('RoomHeader', () => {
	it('says who’s typing, else a thread’s replies, else the topic', () => {
		render({ topic: 'Deploys', topicTitle: 'Deploys and incidents', typing: ['Alice'], replies: { count: 3 } });
		expect(sub()).toEqual(['Alice is typing…']);
		unmount(instance!);
		render({ topic: 'Deploys', replies: { count: 12, more: true } });
		expect(sub()).toEqual(['12+ replies']);
		unmount(instance!);
		render({ topic: 'Deploys', replies: { count: 1 } });
		expect(sub()).toEqual(['1 reply']);
		unmount(instance!);
		render({ topic: 'Deploys', topicTitle: 'Deploys and incidents' });
		expect(document.querySelector('[data-testid="room-description"]')?.getAttribute('title')).toBe('Deploys and incidents');
	});

	it('puts Edit and Leave in a ⋯ menu named for the room or thread, and Join and the member list beside it', () => {
		const onjoin = vi.fn();
		render({ thread: 'deploy', threadName: 'Deploy', onedit: () => {}, onleave: () => {}, onjoin, onmemberlist: () => {}, memberListOpen: true, busy: true });
		const menu = document.querySelector<HTMLButtonElement>('[data-testid="room-actions"]')!;
		expect(menu.getAttribute('aria-label')).toBe('Thread actions');
		expect(menu.disabled).toBe(true);
		const join = document.querySelector<HTMLButtonElement>('[data-testid="join-room"]')!;
		expect([join.getAttribute('aria-label'), join.disabled]).toEqual(['Join thread', true]);
		const members = document.querySelector('.ap-roomhead-members')!;
		expect([members.getAttribute('aria-label'), members.classList.contains('ap-iconbtn-on')]).toEqual(['Hide member list', true]);
		expect(document.querySelector('.ap-roomhead-crumb')?.getAttribute('aria-label')).toBe('Back to room');
		unmount(instance!);
		render({});
		expect(document.querySelector('[data-testid="room-actions"], [data-testid="join-room"], .ap-roomhead-members, .ap-roomhead-back')).toBeNull();
	});
});
