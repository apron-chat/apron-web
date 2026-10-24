import { describe, expect, it } from 'vitest';
import { roomName, roomNameTip, titled } from './naming';

/**
 * The one naming rule, which the client's titles (`roomTitle`) and the design
 * system's names (`roomName`) both apply.
 */
describe('room and thread names', () => {
	it('names by the title unless it is blank; then a thread is Untitled with its room_id on hover, and a room is its room_id', () => {
		const rows: Array<[title: string | undefined | null, roomId: string | undefined, thread: boolean, name: string, tip?: string]> = [
			['Deploy checklist', 't1', false, 'Deploy checklist'],
			['Deploy checklist', 't1', true, 'Deploy checklist'],
			// Kept as given: a title is not trimmed, only tested for being blank.
			['  Ops  ', 't1', false, '  Ops  '],
			[undefined, 't1', false, 't1'],
			[null, 't1', false, 't1'],
			['', 't1', false, 't1'],
			['   ', 't1', false, 't1'],
			['\n\t', 't1', false, 't1'],
			[undefined, 't1', true, 'Untitled', 't1'],
			[null, 't1', true, 'Untitled', 't1'],
			['', 't1', true, 'Untitled', 't1'],
			['   ', 't1', true, 'Untitled', 't1'],
			// Nothing to name it by.
			[undefined, undefined, false, ''],
			[undefined, undefined, true, 'Untitled']
		];
		for (const [title, roomId, thread, name, tip] of rows) {
			const row = JSON.stringify({ title, roomId, thread });
			expect(roomName(title, roomId, { thread }), row).toBe(name);
			expect(roomNameTip(title, roomId, { thread }), row).toBe(tip);
			expect(titled(title), row).toBe(name === title);
		}
	});
});
