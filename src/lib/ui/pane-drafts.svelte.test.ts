import { describe, expect, it } from 'vitest';
import { PaneDrafts, type StagedFile } from './pane-drafts.svelte';

function staged(id: string): StagedFile {
	const file = new File(['x'], `${id}.png`, { type: 'image/png' });
	return { id, file, prepared: Promise.resolve({ file }) };
}

describe('PaneDrafts', () => {
	it('keeps each pane its own draft and reply', () => {
		const drafts = new PaneDrafts();
		drafts.open('lobby');
		drafts.text = 'hello';
		drafts.setReply('m1');
		drafts.open('thread');
		expect([drafts.text, drafts.reply]).toEqual(['', undefined]);
		drafts.text = 'in thread';
		drafts.open('lobby');
		expect([drafts.text, drafts.reply]).toEqual(['hello', 'm1']);
		drafts.open(undefined);
		expect([drafts.current, drafts.text, drafts.reply]).toEqual([undefined, '', undefined]);
		drafts.open('thread');
		expect(drafts.text).toBe('in thread');
	});

	it('gives a failed send back only where nothing new was typed', () => {
		const drafts = new PaneDrafts();
		drafts.open('lobby');
		drafts.text = 'first';
		drafts.clear('lobby');
		expect(drafts.restore('lobby', 'first', 'm1')).toBe(true);
		expect([drafts.text, drafts.reply]).toEqual(['first', 'm1']);

		drafts.clear('lobby');
		drafts.text = 'second';
		expect(drafts.restore('lobby', 'first', undefined)).toBe(false);
		expect(drafts.text).toBe('second');

		drafts.clear('lobby');
		drafts.open('other');
		expect(drafts.restore('lobby', 'first', undefined)).toBe(false);
		drafts.open('lobby');
		expect(drafts.text).toBe('first');
	});

	it('keeps each pane its own staged files, removable before sending', () => {
		const drafts = new PaneDrafts();
		drafts.open('lobby');
		drafts.stage([staged('a'), staged('b')]);
		drafts.open('thread');
		expect(drafts.files).toEqual([]);
		drafts.stage([staged('c')]);
		drafts.open('lobby');
		expect(drafts.files.map(({ id }) => id)).toEqual(['a', 'b']);
		drafts.unstage('a');
		drafts.unstage('c');
		expect(drafts.files.map(({ id }) => id)).toEqual(['b']);
		drafts.open('thread');
		expect(drafts.files).toEqual([]);
		drafts.open(undefined);
		drafts.stage([staged('d')]);
		expect(drafts.files).toEqual([]);
	});

	it('gives staged files back with a failed send, unless something new was attached', () => {
		const drafts = new PaneDrafts();
		drafts.open('lobby');
		const files = [staged('a')];
		drafts.stage(files);
		drafts.clear('lobby');
		expect(drafts.files).toEqual([]);
		expect(drafts.restore('lobby', '', undefined, files)).toBe(true);
		expect(drafts.files).toEqual(files);

		drafts.clear('lobby');
		drafts.stage([staged('b')]);
		expect(drafts.restore('lobby', 'caption', undefined, files)).toBe(false);
		expect([drafts.text, drafts.files.map(({ id }) => id)]).toEqual(['', ['b']]);
	});

	it('says when reloading would lose a draft: text or files, in the open pane or a kept one', () => {
		const drafts = new PaneDrafts();
		expect(drafts.unsent).toBe(false);
		drafts.open('lobby');
		drafts.text = '   ';
		drafts.setReply('m1');
		expect(drafts.unsent).toBe(false);
		drafts.text = 'hello';
		expect(drafts.unsent).toBe(true);
		drafts.open('thread');
		expect(drafts.unsent).toBe(true);
		drafts.open('lobby');
		drafts.clear('lobby');
		expect(drafts.unsent).toBe(false);
		drafts.stage([staged('a')]);
		drafts.open('thread');
		expect(drafts.unsent).toBe(true);
		drafts.unstage('a');
		expect(drafts.unsent).toBe(false);
	});
});
