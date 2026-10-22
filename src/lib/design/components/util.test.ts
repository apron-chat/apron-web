import { describe, expect, it } from 'vitest';
import { roomName } from './util';

describe('roomName', () => {
	it('names a room or thread by its title, else its room_id (§3.4)', () => {
		expect(roomName('Deploy checklist', 't1')).toBe('Deploy checklist');
		expect(roomName(undefined, 't1')).toBe('t1');
		expect(roomName(null, 't1')).toBe('t1');
	});

	it('never names one by a blank: an empty or all-space title counts as none', () => {
		expect(roomName('', 't1')).toBe('t1');
		expect(roomName('   ', 't1')).toBe('t1');
		expect(roomName('\n\t', 't1')).toBe('t1');
	});

	it('keeps a title as written, spaces and all', () => {
		expect(roomName('  Ops  ', 't1')).toBe('  Ops  ');
	});
});
