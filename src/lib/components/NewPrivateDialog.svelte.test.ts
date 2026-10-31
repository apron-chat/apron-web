// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChatClient, ClientSnapshot, RoomSnapshot } from '$lib/protocol/client';
import type { Identity } from '$lib/protocol/types';
import { directory } from '$lib/ui/directory.svelte';
import { blankSnapshot, type SessionView } from '$lib/ui/session.svelte';
import NewPrivateDialog from './NewPrivateDialog.svelte';
import * as dom from '$lib/test/dom';
import { byLabel } from '$lib/test/queries';

beforeAll(dom.stubDialog);
afterEach(() => directory.forget());

const ada: Identity = { user_id: 'ada', name: 'Ada' };
const people: Identity[] = [ada, { user_id: 'bob', name: 'Bob' }, { user_id: 'carol', name: 'Carol' }, { user_id: '~server', name: 'Server' }];
const members = (...ids: string[]) => ids.map((user_id) => ({ user_id }));
const dm = (id: string, other: string, latestLogId?: string) =>
	({ id, title: other, joined: true, private: true, namedForMembers: true, members: members('ada', other), ...(latestLogId ? { latestLogId } : {}) }) as unknown as RoomSnapshot;

function render(rooms: RoomSnapshot[] = [], limit?: number) {
	const server = { apron: 10, auth: ['guest'], capabilities: ['rooms', 'ext:settings'], ...(limit !== undefined ? { ext: { settings: { private_rooms: limit } } } : {}) };
	const snapshot: ClientSnapshot = { ...blankSnapshot(), authenticated: true, you: ada, rooms, server, users: Object.fromEntries(people.map((user) => [user.user_id, user])) };
	directory.apply(snapshot, undefined);
	const session = { snapshot, rooms, you: ada, server } as unknown as SessionView;
	const client = { leaveRoom: vi.fn(() => ({ id: 'c1', promise: Promise.resolve({}) })), createRoom: vi.fn(), joinRoom: vi.fn(), subscribe: vi.fn() };
	const onopen = vi.fn();
	dom.render(NewPrivateDialog, { client: client as unknown as ChatClient, session, enabled: true, onopen, onclose: vi.fn() });
	flushSync();
	return { client, onopen, list: () => document.querySelector('[data-testid="private-people"]')!, field: byLabel('To') };
}

const names = (list: Element) => [...list.querySelectorAll('.ap-pick-who-name')].map((name) => name.textContent);

describe('NewPrivateDialog', () => {
	it('lists the people the session knows but you and the system, narrowed by a name or @user_id typed', () => {
		const { list, field } = render();
		expect(names(list())).toEqual(['Bob', 'Carol']);
		dom.type(field, '@car');
		expect(names(list())).toEqual(['Carol']);
	});

	it('opens the conversation you already have with the one person picked', () => {
		const { list, onopen } = render([dm('p1', 'bob')]);
		const bob = list().querySelector<HTMLElement>('[role="option"]')!;
		expect(bob.textContent).toContain('Already talking · Open');
		bob.click();
		expect(onopen).toHaveBeenCalledWith('p1');
	});

	it('counts your private rooms against the limit, and at it offers them to leave, the quietest first', () => {
		const { client } = render([dm('p1', 'bob', '1720000000000'), dm('p2', 'carol', '1710000000000')], 2);
		expect(document.querySelector('.ap-quota')?.textContent?.trim()).toBe('2 of 2');
		expect(document.querySelector('[data-testid="private-people"]')).toBeNull();
		expect([...document.querySelectorAll('.ap-pick-rooms .ap-pick-who-name')].map((name) => name.textContent)).toEqual(['carol', 'bob']);
		dom.button('Leave carol').click();
		expect(client.leaveRoom).toHaveBeenCalledWith('p2');
	});
});
