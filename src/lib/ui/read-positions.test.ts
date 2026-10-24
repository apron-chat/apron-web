import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageRecord } from '$lib/protocol/types';
import { ReadPositions, newestOwn } from './read-positions';
import { advanceReadPositions, loadReadPositions, readPositionKey } from './storage';
import { memoryStorage } from '$lib/test/storage';
import { messageRecord, roomSnapshot as room } from '$lib/test/builders';

const me = { user_id: 'sam', name: 'Sam' };
const ada = 'wss://a.example/\nada';

const message = (id: number, roomId: string, from = 'ada'): MessageRecord => messageRecord(id, roomId, { from: { user_id: from } });

const values = new Map<string, string>();

beforeEach(() => {
	vi.stubGlobal('localStorage', memoryStorage(values));
});

afterEach(() => {
	values.clear();
	vi.unstubAllGlobals();
});

describe('read positions', () => {
	it('keeps what you read per account and room, for the next visit', () => {
		const positions = new ReadPositions(() => ada);
		const general = room('general', [message(10, 'general'), message(11, 'general')]);
		expect(positions.through(general, me)).toBeUndefined();
		positions.read('general', '10');
		expect(positions.through(general, me)).toBe('10');
		// Only forward.
		positions.read('general', '9');
		expect(loadReadPositions()).toEqual({ [readPositionKey(ada, 'general')]: '10' });
		// The next visit, or another account here.
		expect(new ReadPositions(() => ada).through(general, me)).toBe('10');
		expect(new ReadPositions(() => 'wss://a.example/\nbob').through(general, me)).toBeUndefined();
	});

	it('takes the server cursor or your own newest message, whichever is furthest', () => {
		const positions = new ReadPositions(() => ada);
		positions.read('general', '10');
		const messages = [message(10, 'general'), message(11, 'general'), message(12, 'general', 'sam'), message(13, 'general')];
		// Your message from another device: you had read up to it.
		expect(positions.through(room('general', messages), me)).toBe('12');
		expect(positions.through(room('general', messages, { readMessageId: '13' }), me)).toBe('13');
		// Your newest message after a position, if any.
		const timeline = room('general', [message(10, 'general', 'sam'), ...messages.slice(1)]).timeline;
		expect([newestOwn(timeline, me), newestOwn(timeline, me, '11'), newestOwn(timeline, me, '12'), newestOwn(timeline, undefined)]).toEqual(['12', '12', undefined, undefined]);
		// Observing keeps it for the next visit; a thread is a room of its own.
		positions.observe([room('general', messages), room('plans', [message(20, 'plans', 'sam')], { parentRoomId: 'general' })], me);
		expect(loadReadPositions()).toEqual({ [readPositionKey(ada, 'general')]: '12', [readPositionKey(ada, 'plans')]: '20' });
	});

	it('reads again what another tab read, when asked', () => {
		const positions = new ReadPositions(() => ada);
		const general = room('general', [message(10, 'general'), message(11, 'general')]);
		positions.read('general', '10');
		advanceReadPositions({ [readPositionKey(ada, 'general')]: '11' });
		expect(positions.through(general, me)).toBe('10');
		expect(positions.through(general, me, true)).toBe('11');
	});

	it('keeps positions for the page when storage is unavailable', () => {
		vi.stubGlobal('localStorage', {
			getItem: () => { throw new Error('denied'); },
			setItem: () => { throw new Error('denied'); },
			removeItem: () => { throw new Error('denied'); }
		});
		const positions = new ReadPositions(() => ada);
		positions.read('general', '10');
		expect(positions.through(room('general', []), me)).toBe('10');
		// Reading storage again keeps what is only kept here.
		expect(positions.through(room('general', []), me, true)).toBe('10');
	});
});

describe('read position storage', () => {
	it('moves positions forward only, keeping the 500 moved most recently, the latest last', () => {
		const general = readPositionKey(ada, 'general');
		const random = readPositionKey(ada, 'random');
		advanceReadPositions({ [general]: '10', [random]: '20' });
		advanceReadPositions({ [general]: '9' });
		expect(Object.entries(loadReadPositions())).toEqual([[general, '10'], [random, '20']]);
		advanceReadPositions({ [general]: '11' });
		expect(Object.entries(loadReadPositions())).toEqual([[random, '20'], [general, '11']]);
		values.set('apron.readPositions', JSON.stringify({ [general]: 'nope', [random]: '20' }));
		expect(loadReadPositions()).toEqual({ [random]: '20' });
		values.set('apron.readPositions', '{broken');
		expect(loadReadPositions()).toEqual({});
		// The 500 moved most recently.
		const many = Object.fromEntries(Array.from({ length: 501 }, (_, index) => [readPositionKey(ada, `room${index}`), '10']));
		advanceReadPositions(many);
		const kept = loadReadPositions();
		expect(Object.keys(kept)).toHaveLength(500);
		expect(kept[readPositionKey(ada, 'room0')]).toBeUndefined();
		expect(kept[readPositionKey(ada, 'room500')]).toBe('10');
	});
});
