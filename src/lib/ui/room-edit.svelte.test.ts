import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryStorage } from '$lib/test/storage';
import { notifyAccount } from './notify-scopes';
import { DraftKeeper } from './draft-keeper.svelte';
import { RoomEdit, type EditedRoom } from './room-edit.svelte';
import { loadDraft } from './storage';

const values = new Map<string, string>();
let tests = 0;
let server = '';
const keyOf = (roomId: string) => JSON.stringify([server, roomId, 'edit']);
const room: EditedRoom = { id: 'general', title: 'General', description: 'Say hello.' };

/** A visit: the page's RoomEdit on its own DraftKeeper, as Ada, with what `ask` answers each confirm. */
function visit(answers: boolean[] = []) {
	const keeper = new DraftKeeper(() => true, () => notifyAccount(server, 'ada'));
	const asked: string[] = [];
	const edit = new RoomEdit(keyOf, keeper, (question) => (asked.push(question), answers.shift() ?? false));
	return { keeper, edit, asked };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal('localStorage', memoryStorage(values));
	server = `wss://chat${++tests}.example/`;
});

afterEach(() => {
	values.clear();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('RoomEdit', () => {
	it('opens to read, then to edit from the room as it reads, a draft only once it reads otherwise', () => {
		const { edit } = visit();
		edit.open(room);
		expect(edit.shown).toEqual({ id: 'general', editing: false });
		edit.start(room);
		expect(edit.editing).toMatchObject({ title: 'General', text: 'Say hello.' });
		expect(edit.drafted('general')).toBe(false);
		edit.setText('general', 'Say hello, then read the rules.');
		expect(edit.drafted('general')).toBe(true);
		// Typed back as it was (give or take the spaces round it): no draft.
		edit.setText('general', 'Say hello. ');
		expect(edit.drafted('general')).toBe(false);
	});

	it('keeps a draft for the next visit, as the composer’s are, and takes it up again on Edit', () => {
		const first = visit();
		first.edit.start(room);
		first.edit.setTitle('general', 'General chat');
		first.edit.setText('general', 'Hello, all.');
		first.keeper.flush();
		expect(loadDraft(keyOf('general'))?.draft).toMatchObject({ title: 'General chat', text: 'Hello, all.' });

		const next = visit();
		next.edit.recall(room);
		expect(next.edit.drafted('general')).toBe(true);
		next.edit.start(room);
		expect(next.edit.editing).toMatchObject({ title: 'General chat', text: 'Hello, all.' });
	});

	it('forgets a kept draft that reads as the room now does', () => {
		const first = visit();
		first.edit.start(room);
		first.edit.setText('general', 'Hello, all.');
		first.keeper.flush();
		const next = visit();
		next.edit.recall({ ...room, description: 'Hello, all.' });
		expect(next.edit.drafted('general')).toBe(false);
		next.keeper.flush();
		expect(loadDraft(keyOf('general'))).toBeUndefined();
	});

	it('asks before Cancel or close discard a draft, and keeps it on No', () => {
		const { edit, asked, keeper } = visit([false, true]);
		edit.start(room);
		edit.setText('general', 'Hello, all.');
		expect(edit.cancel(room, false)).toBe(false);
		expect(asked).toEqual(['Discard your changes to this room?']);
		expect(edit.editing?.text).toBe('Hello, all.');
		expect(edit.close(room, false)).toBe(true);
		expect(edit.shown).toBeUndefined();
		expect(edit.drafted('general')).toBe(false);
		keeper.flush();
		expect(loadDraft(keyOf('general'))).toBeUndefined();
	});

	it('stops editing without asking when nothing changed, back to reading the description, or shut with none', () => {
		const { edit, asked } = visit();
		edit.start(room);
		expect(edit.cancel(room, false)).toBe(true);
		expect(edit.shown).toEqual({ id: 'general', editing: false });
		edit.start({ ...room, description: undefined });
		expect(edit.cancel({ ...room, description: undefined }, true)).toBe(true);
		expect(edit.shown).toBeUndefined();
		expect(asked).toEqual([]);
	});

	it('leaving the room keeps the draft, to come back to', () => {
		const { edit } = visit();
		edit.start(room);
		edit.setText('general', 'Hello, all.');
		edit.leave();
		expect(edit.shown).toBeUndefined();
		expect(edit.drafted('general')).toBe(true);
	});

	it('saves only what changed, an emptied field as null, and shows the description as saved', async () => {
		const { edit, keeper } = visit();
		const update = vi.fn(async () => {});
		edit.start(room);
		edit.setText('general', '  ');
		expect(await edit.save(room, false, update)).toEqual({ description: null });
		expect(update).toHaveBeenCalledWith({ description: null });
		// Emptied, there is nothing to read: shut.
		expect(edit.shown).toBeUndefined();
		expect(edit.drafted('general')).toBe(false);
		keeper.flush();
		expect(loadDraft(keyOf('general'))).toBeUndefined();

		edit.start(room);
		edit.setTitle('general', ' Lobby ');
		expect(await edit.save(room, false, update)).toEqual({ title: 'Lobby' });
		expect(edit.shown).toEqual({ id: 'general', editing: false });
	});

	it('asks before saving over what someone else changed since the edit began', async () => {
		const { edit, asked } = visit([false, true]);
		const update = vi.fn(async () => {});
		edit.start(room);
		edit.setText('general', 'Mine.');
		const changed = { ...room, description: 'Theirs.' };
		expect(await edit.save(changed, true, update)).toBeUndefined();
		expect(asked).toEqual(['Someone changed this thread since you started editing it. Replace their changes with yours?']);
		expect(update).not.toHaveBeenCalled();
		expect(edit.editing?.text).toBe('Mine.');
		expect(await edit.save(changed, true, update)).toEqual({ description: 'Mine.' });
	});

	it('keeps the draft, and says why, when the server declines', async () => {
		const { edit } = visit();
		edit.start(room);
		edit.setText('general', 'Mine.');
		expect(await edit.save(room, false, async () => { throw new Error('Not allowed'); })).toBeUndefined();
		expect(edit.task.note).toBe('Not allowed');
		expect(edit.shown?.editing).toBe(true);
		expect(edit.drafted('general')).toBe(true);
	});
});
