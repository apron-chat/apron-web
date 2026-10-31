import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequestTimeout } from './client-internals';
import { RateLimitError } from './client-types';
import { HistoryQueue, LATE_ANSWER_MS } from './history-queue';
import type { JsonObject } from './types';

/**
 * The history queue on its own, against a connection that only records what
 * it sends: order, how many are out, holding during a wait, and taking back.
 * Through the client in client.recovery.test.ts and client.limits.test.ts.
 */
interface Sent {
	id: string;
	params: JsonObject;
	resolve: (result: JsonObject) => void;
	reject: (error: Error) => void;
}

function connection(concurrency?: number) {
	const sent: Sent[] = [];
	const state = { limited: false, active: undefined as string | undefined, emits: 0 };
	let next = 0;
	const queue = new HistoryQueue({
		send: (params) => {
			const id = `req_${next++}`;
			const promise = new Promise<JsonObject>((resolve, reject) => {
				sent.push({ id, params, resolve, reject });
			});
			return { id, promise };
		},
		limited: () => state.limited,
		activeRoomId: () => state.active,
		emit: () => {
			state.emits += 1;
		}
	}, concurrency);
	const rooms = () => sent.map((entry) => entry.params.room_id);
	return { queue, sent, state, rooms };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const refused = () => new RateLimitError('Too Many Requests. Try again in 5s.', 'Too Many Requests', 5_000, 'history');

afterEach(() => {
	vi.useRealTimers();
});

describe('the history queue', () => {
	it('sends one at a time by default, what the reader waits for first, then the rest in the order asked', async () => {
		const { queue, sent, state, rooms } = connection();
		state.active = 'open';
		queue.request('a', { room_id: 'a' });
		queue.request('b', { room_id: 'b' });
		queue.request('open', { room_id: 'open' });
		queue.request('thread', { room_id: 'thread' }, { retry: true });
		expect(rooms()).toEqual(['a']);
		for (const expected of [['a', 'open'], ['a', 'open', 'thread'], ['a', 'open', 'thread', 'b']]) {
			sent.at(-1)!.resolve({});
			await settle();
			expect(rooms()).toEqual(expected);
		}
	});

	it('keeps the slot for the next page of one that went first, asked once its answer is read, then frees it', async () => {
		const { queue, sent, state, rooms } = connection();
		state.active = 'general';
		const pages = (left: number): Promise<unknown> => queue.request('general', { room_id: 'general' }).promise.then(() => (left > 1 ? pages(left - 1) : undefined));
		void pages(3);
		void queue.request('ops', { room_id: 'ops' }).promise;
		for (let page = 0; page < 3; page++) {
			sent.at(-1)!.resolve({});
			await settle();
		}
		// Each next page is asked for in its answer's callback, a turn after the slot is free, and still goes first.
		expect(rooms()).toEqual(['general', 'general', 'general', 'ops']);
	});

	it('keeps it from other rooms only, not from what the reader waits for, such as a thread opened meanwhile', async () => {
		const { queue, sent, state, rooms } = connection();
		state.active = 'general';
		const pages = (left: number): Promise<unknown> => queue.request('general', { room_id: 'general' }).promise.then(() => (left > 1 ? pages(left - 1) : undefined));
		void pages(3);
		void queue.request('ops', { room_id: 'ops' }).promise;
		void queue.request('thread', { room_id: 'thread' }, { retry: true }).promise;
		for (let page = 0; page < 4; page++) {
			sent.at(-1)!.resolve({});
			await settle();
		}
		expect(rooms()).toEqual(['general', 'thread', 'general', 'general', 'ops']);
	});

	it('has as many out as it may', async () => {
		const { queue, sent, rooms } = connection(2);
		for (const room of ['a', 'b', 'c']) queue.request(room, { room_id: room });
		expect(rooms()).toEqual(['a', 'b']);
		sent[1].resolve({});
		await settle();
		expect(rooms()).toEqual(['a', 'b', 'c']);
	});

	it('answers each with its own result, whatever order the answers come in', async () => {
		const { queue, sent } = connection(2);
		const a = queue.request('a', { room_id: 'a' });
		const b = queue.request('b', { room_id: 'b' });
		sent[1].resolve({ more: true });
		sent[0].resolve({ more: false });
		await expect(a.promise).resolves.toEqual({ more: false });
		await expect(b.promise).resolves.toEqual({ more: true });
		expect([queue.holds('a'), queue.holds('b')]).toEqual([false, false]);
	});

	it('holds everything during a wait, and sends it once pumped after the wait', async () => {
		const { queue, state, rooms } = connection();
		state.limited = true;
		queue.request('a', { room_id: 'a' });
		queue.request('b', { room_id: 'b' });
		expect(rooms()).toEqual([]);
		expect(queue.holds('a')).toBe(true);
		expect(queue.queued(queue.request('c', { room_id: 'c' }).id)).toMatchObject({ roomId: 'c' });
		state.limited = false;
		queue.pump();
		expect(rooms()).toEqual(['a']);
	});

	it('holds one with retry refused for a wait, in its place, and sends it again after the wait', async () => {
		const { queue, sent, state, rooms } = connection();
		const handle = queue.request('thread', { room_id: 'thread' }, { retry: true });
		queue.request('b', { room_id: 'b' });
		state.limited = true;
		sent[0].reject(refused());
		await settle();
		expect(state.emits).toBe(1);
		expect(queue.holds('thread')).toBe(true);
		expect(rooms()).toEqual(['thread']);
		state.limited = false;
		queue.pump();
		expect(rooms()).toEqual(['thread', 'thread']);
		sent[1].resolve({ more: false });
		await expect(handle.promise).resolves.toEqual({ more: false });
	});

	it('fails one without retry refused for a wait, and one with retry refused for anything else', async () => {
		const { queue, sent, state } = connection();
		const plain = queue.request('a', { room_id: 'a' });
		const retried = queue.request('b', { room_id: 'b' }, { retry: true });
		state.limited = true;
		sent[0].reject(refused());
		await expect(plain.promise).rejects.toBeInstanceOf(RateLimitError);
		state.limited = false;
		queue.pump();
		sent[1].reject(new Error('Room not found'));
		await expect(retried.promise).rejects.toThrow('Room not found');
		expect(queue.holds('b')).toBe(false);
	});

	it('holds one with retry refused for a wait that is already over, or none, and sends it again at its end', async () => {
		vi.useFakeTimers();
		const { queue, sent, rooms } = connection();
		const handle = queue.request('thread', { room_id: 'thread' }, { retry: true });
		// retry_after 0: the connection has no wait on by the time the refusal is handled.
		sent[0].reject(new RateLimitError('Too Many Requests. Try again in 1s.', 'Too Many Requests', Date.now(), 'history'));
		await vi.advanceTimersByTimeAsync(0);
		expect(rooms()).toEqual(['thread', 'thread']);
		sent[1].reject(new RateLimitError('Too Many Requests. Try again in 2s.', 'Too Many Requests', Date.now() + 2_000, 'history'));
		await vi.advanceTimersByTimeAsync(1_999);
		expect(queue.holds('thread')).toBe(true);
		await vi.advanceTimersByTimeAsync(1);
		expect(rooms()).toEqual(['thread', 'thread', 'thread']);
		sent[2].resolve({ more: false });
		await expect(handle.promise).resolves.toEqual({ more: false });
	});

	it('takes back a held request without sending it', async () => {
		const { queue, state, rooms } = connection();
		state.limited = true;
		const handle = queue.request('a', { room_id: 'a' });
		queue.cancel(handle.id, 'Nothing to recover');
		await expect(handle.promise).rejects.toThrow('Nothing to recover');
		state.limited = false;
		queue.pump();
		expect(rooms()).toEqual([]);
		expect(queue.queued(handle.id)).toBeUndefined();
	});

	it('takes back a sent request at once, but sends the next only once the server answers it, and ignores the answer', async () => {
		const { queue, sent, rooms } = connection();
		const handle = queue.request('a', { room_id: 'a' });
		const next = queue.request('b', { room_id: 'b' });
		queue.cancel(handle.id, 'History recovery superseded');
		await expect(handle.promise).rejects.toThrow('History recovery superseded');
		// The server may still be working on it: the next waits for its answer.
		await settle();
		expect(rooms()).toEqual(['a']);
		sent[0].resolve({ more: false });
		await settle();
		expect(rooms()).toEqual(['a', 'b']);
		// A refusal of the taken-back request frees its place too, without holding it for a wait.
		queue.cancel(next.id, 'Room left');
		quietly(next.promise);
		queue.request('c', { room_id: 'c' }, { retry: true });
		sent[1].reject(refused());
		await settle();
		expect(rooms()).toEqual(['a', 'b', 'c']);
	});

	it('fails one that timed out at once, and keeps its place until its late answer or LATE_ANSWER_MS', async () => {
		vi.useFakeTimers();
		const { queue, sent, rooms } = connection();
		const first = queue.request('a', { room_id: 'a' });
		quietly(queue.request('b', { room_id: 'b' }).promise);
		sent[0].reject(new RequestTimeout('history'));
		await expect(first.promise).rejects.toBeInstanceOf(RequestTimeout);
		await vi.advanceTimersByTimeAsync(LATE_ANSWER_MS - 1);
		expect(rooms()).toEqual(['a']);
		await vi.advanceTimersByTimeAsync(1);
		expect(rooms()).toEqual(['a', 'b']);
		// One whose late answer comes sooner frees its place then.
		queue.request('c', { room_id: 'c' });
		sent[1].reject(new RequestTimeout('history'));
		await vi.advanceTimersByTimeAsync(1_000);
		expect(rooms()).toEqual(['a', 'b']);
		queue.answered(sent[1].id);
		expect(rooms()).toEqual(['a', 'b', 'c']);
	});

	it('drops the requests held for a room, and only those', async () => {
		const { queue, sent, state, rooms } = connection();
		const out = queue.request('a', { room_id: 'a' });
		state.limited = true;
		const older = queue.request('a', { room_id: 'a', before: '9' }, { retry: true });
		queue.request('b', { room_id: 'b' });
		queue.dropRoom('a', 'Room left');
		await expect(older.promise).rejects.toThrow('Room left');
		expect(queue.holds('a')).toBe(false);
		expect(queue.holds('b')).toBe(true);
		state.limited = false;
		sent[0].resolve({});
		await expect(out.promise).resolves.toEqual({});
		expect(rooms()).toEqual(['a', 'b']);
	});

	it('drops held requests, leaving sent ones to fail with their requests', async () => {
		const { queue, sent } = connection();
		const out = queue.request('a', { room_id: 'a' });
		const held = queue.request('b', { room_id: 'b' });
		queue.dropHeld('Connection closed');
		await expect(held.promise).rejects.toThrow('Connection closed');
		sent[0].reject(new Error('Connection closed; delivery is uncertain. Please retry'));
		await expect(out.promise).rejects.toThrow('delivery is uncertain');
		expect(sent).toHaveLength(1);
	});

	it('forgets one that timed out when the connection goes', async () => {
		vi.useFakeTimers();
		const { queue, sent, rooms } = connection();
		quietly(queue.request('a', { room_id: 'a' }).promise);
		sent[0].reject(new RequestTimeout('history'));
		await vi.advanceTimersByTimeAsync(0);
		queue.dropHeld('Connection closed');
		queue.request('b', { room_id: 'b' });
		expect(rooms()).toEqual(['a', 'b']);
	});
});

function quietly(promise: Promise<unknown>): void {
	promise.catch(() => undefined);
}
