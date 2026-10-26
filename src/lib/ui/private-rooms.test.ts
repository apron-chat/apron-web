import { describe, expect, it, vi } from 'vitest';
import type { ClientSnapshot, OperationHandle, RoomSnapshot } from '$lib/protocol/client';
import { roomSnapshot as room } from '$lib/test/builders';
import { ArrivalWatch, directRoomWith, NO_PRIVATE_ROOMS, othersIn, privateRooms, quietestFirst, startPrivateRoom } from './private-rooms';

const members = (...ids: string[]) => ids.map((user_id) => ({ user_id }));
const dm = (id: string, ...ids: string[]) => room(id, [], { private: true, namedForMembers: true, members: members('ada', ...ids) });

describe('private rooms', () => {
	it('counts the joined top-level private rooms, not their threads, rooms read without joining, or ordinary rooms', () => {
		const rooms = [dm('p1', 'bob'), room('p2', [], { private: true, title: 'Launch' }), room('t1', [], { private: true, parentRoomId: 'p2' }), room('p3', [], { private: true, joined: false }), room('general')];
		expect(privateRooms(rooms).map((entry) => entry.id)).toEqual(['p1', 'p2']);
		expect(othersIn(rooms[0], 'ada')).toEqual([{ user_id: 'bob' }]);
		expect(othersIn(undefined, 'ada')).toEqual([]);
	});

	it('finds the conversation you already have with someone: untitled, private, just the two of you', () => {
		const withBob = dm('p1', 'bob');
		const group = dm('p2', 'bob', 'carol');
		const titled = room('p3', [], { private: true, title: 'Bob and me', members: members('ada', 'bob') });
		const truncated = { ...dm('p4', 'carol'), memberCount: 40 };
		const thread = { ...dm('p5', 'dev'), parentRoomId: 'p2' };
		const rooms = [group, titled, withBob, truncated, thread];
		expect(directRoomWith(rooms, 'ada', 'bob')?.id).toBe('p1');
		expect(directRoomWith(rooms, 'ada', 'carol')).toBeUndefined();
		expect(directRoomWith(rooms, 'ada', 'dev')).toBeUndefined();
		expect(directRoomWith(rooms, 'ada', 'ada')).toBeUndefined();
		expect(directRoomWith(rooms, undefined, 'bob')).toBeUndefined();
	});

	it('puts the quietest first', () => {
		const rooms = [room('a', [], { latestLogId: '30' }), room('b', [], { latestLogId: '10' }), room('c')];
		expect(quietestFirst(rooms).map((entry) => entry.id)).toEqual(['c', 'b', 'a']);
	});
});

/** A client whose room_set names `p1` and whose snapshot lists it as `record`, with room_join answered by `joins`. */
function fakeClient(options: { record?: Partial<RoomSnapshot>; create?: Promise<{ room_id: string }>; joins?: Record<string, Error> } = {}) {
	const handle = <T,>(promise: Promise<T>) => ({ id: 'c1', promise }) as unknown as OperationHandle<any>;
	const snapshot = { rooms: [room('p1', [], { private: true, ...options.record })] } as ClientSnapshot;
	return {
		createRoom: vi.fn(() => handle(options.create ?? Promise.resolve({ room_id: 'p1' }))),
		joinRoom: vi.fn((_room: string, userId?: string) => handle(options.joins?.[userId ?? ''] ? Promise.reject(options.joins[userId!]) : Promise.resolve({}))),
		subscribe: vi.fn((listener: (next: ClientSnapshot) => void) => {
			listener(snapshot);
			return () => true;
		})
	};
}

describe('startPrivateRoom', () => {
	it('creates the room private, checks its record, then adds each person in turn, keeping the room when one fails', async () => {
		const client = fakeClient({ joins: { carol: new Error('Carol is in too many private rooms') } });
		const started = await startPrivateRoom(client, ['bob', 'carol', 'dev'], { title: 'Launch' });
		expect(client.createRoom).toHaveBeenCalledWith({ private: true, title: 'Launch' });
		expect(client.joinRoom.mock.calls).toEqual([['p1', 'bob'], ['p1', 'carol'], ['p1', 'dev']]);
		expect(started).toEqual({ roomId: 'p1', failed: [{ userId: 'carol', message: 'Carol is in too many private rooms' }] });
	});

	it('says a server has no private rooms when it answers unsupported, and shows any other refusal as it is', async () => {
		const unsupported = Object.assign(new Error('Method not found'), { code: -32601 });
		await expect(startPrivateRoom(fakeClient({ create: Promise.reject(unsupported) }), ['bob'])).rejects.toThrow(NO_PRIVATE_ROOMS);
		const denied = Object.assign(new Error('You can start 5 private rooms a day'), { code: -32001 });
		await expect(startPrivateRoom(fakeClient({ create: Promise.reject(denied) }), ['bob'])).rejects.toThrow('You can start 5 private rooms a day');
	});

	it('adds no one to a room that came back without private: true', async () => {
		const client = fakeClient({ record: { private: undefined } });
		await expect(startPrivateRoom(client, ['bob'])).rejects.toThrow(/ordinary room that others can see/);
		expect(client.joinRoom).not.toHaveBeenCalled();
	});
});

describe('ArrivalWatch', () => {
	const snapshot = (rooms: RoomSnapshot[], pending: ClientSnapshot['pending'] = []) =>
		({ you: { user_id: 'ada' }, roomsListed: true, rooms, pending }) as Pick<ClientSnapshot, 'you' | 'rooms' | 'roomsListed' | 'pending'>;

	it('notices a private room someone else added you to, not the ones listed at sign-in or ones you asked for', () => {
		const watch = new ArrivalWatch();
		expect(watch.next({ ...snapshot([dm('p1', 'bob')]), roomsListed: false })).toEqual([]);
		expect(watch.next(snapshot([dm('p1', 'bob')]))).toEqual([]);
		// Added by someone: new, private, and nothing of yours in flight.
		expect(watch.next(snapshot([dm('p1', 'bob'), dm('p2', 'carol')]))).toEqual(['p2']);
		// Created here (a room_set in flight), or joined here, or started here: yours.
		expect(watch.next(snapshot([dm('p1', 'bob'), dm('p2', 'carol'), dm('p3')], [{ id: 'c1', method: 'room_set', createdAt: 0 }]))).toEqual([]);
		expect(watch.next(snapshot([dm('p1', 'bob'), dm('p2', 'carol'), dm('p3'), dm('p4')], [{ id: 'c2', method: 'room_join', room: 'p4', createdAt: 0 }]))).toEqual([]);
		watch.mine('p5');
		expect(watch.next(snapshot([dm('p5'), room('general')]))).toEqual([]);
		// Left and added again: counts again.
		expect(watch.next(snapshot([dm('p5'), room('general'), dm('p2', 'carol')]))).toEqual(['p2']);
		// Another account signing in starts over.
		expect(watch.next({ ...snapshot([dm('p9', 'bob')]), you: { user_id: 'bob' } })).toEqual([]);
	});
});
