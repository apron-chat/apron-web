import { describe, expect, it } from 'vitest';
import { createdRoom, createdThread, moveCheck, notPrivate, PRIVACY_LOST } from './created';

const secret = { id: 'secret', title: 'Secret', private: true as const };
const open = { id: 'general', title: 'General' };
const thread = (id: string, isPrivate: boolean) => ({ id, title: id, parentRoomId: 'secret', ...(isPrivate ? { private: true as const } : {}) });

describe('a thread this page created', () => {
	it('waits until its room_update has listed it, then opens a private room’s thread that came back private, and any thread of an ordinary room', () => {
		expect(createdThread({ room: 'secret', thread: 't1' }, [secret])).toBe('wait');
		expect(createdThread({ room: 'secret', thread: 't1', replyTo: '5' }, [secret, thread('t1', true)])).toBe('open');
		expect(createdThread({ room: 'general', thread: 't2' }, [open, { id: 't2', title: 't2' }])).toBe('open');
	});

	it('refuses a private room’s thread the server made visible to others, so nothing is posted into it, unless messages were moved into it', () => {
		expect(createdThread({ room: 'secret', thread: 't1', replyTo: '5' }, [secret, thread('t1', false)])).toEqual({ refuse: PRIVACY_LOST });
		// Unless messages were moved into it: the move checked its privacy first.
		expect(createdThread({ room: 'secret', thread: 't1', moved: true }, [secret, thread('t1', false)])).toBe('open');
	});
});

describe('moving into a new thread', () => {
	it('refuses a thread of a private room that came back without privacy, as the rooms are when it runs', () => {
		let rooms = [secret, thread('t1', true)];
		const check = moveCheck(() => rooms, 'secret');
		expect(check('t1')).toBeUndefined();
		rooms = [secret, thread('t1', false)];
		expect(check('t1')?.message).toBe(PRIVACY_LOST);
		expect(moveCheck(() => [open, { id: 't2', title: 't2' }], 'general')('t2')).toBeUndefined();
	});
});

describe('a room this page created', () => {
	it('opens it, unless it was asked to be private and came back ordinary', () => {
		expect(createdRoom(secret, true)).toEqual({ open: secret });
		expect(createdRoom(open, false)).toEqual({ open });
		expect(createdRoom(open, true)).toEqual({ refuse: notPrivate('General') });
		expect(notPrivate('General')).toBe('The server made “General” an ordinary room that others can see and join, not a private one. Leave it, or use it knowing that.');
	});
});
