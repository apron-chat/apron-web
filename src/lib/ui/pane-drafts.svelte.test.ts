import { describe, expect, it } from 'vitest';
import { PaneDrafts, type DraftStore, type StagedFile } from './pane-drafts.svelte';
import type { SavedDraft } from './storage';

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

	it('gives a failed send back, text and files, only where nothing new was typed or attached', () => {
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
		// Staged files too, unless something new was attached.
		drafts.clear('lobby');
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

	it('keeps each pane the link previews removed from its draft, until it is sent, and gives them back with a failed send', () => {
		const drafts = new PaneDrafts();
		drafts.open('lobby');
		drafts.text = 'see https://example.com';
		drafts.dismissed = ['https://example.com'];
		drafts.open('thread');
		expect(drafts.dismissed).toEqual([]);
		drafts.open('lobby');
		expect(drafts.dismissed).toEqual(['https://example.com']);
		const dismissed = drafts.dismissed;
		drafts.clear('lobby');
		expect(drafts.dismissed).toEqual([]);
		expect(drafts.restore('lobby', 'see https://example.com', undefined, [], dismissed)).toBe(true);
		expect(drafts.dismissed).toEqual(['https://example.com']);
		// Gone out as a live message: forgotten with the text.
		drafts.forget('lobby');
		expect(drafts.dismissed).toEqual([]);
	});

	it('keeps each pane its own staged files, removable and renamable before sending', () => {
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
		// Renamed on whichever draft holds the file.
		drafts.open('lobby');
		drafts.stage([staged('e')]);
		drafts.rename('e', 'sunset.jpg');
		expect(drafts.files.map(({ title }) => title)).toEqual([undefined, 'sunset.jpg']);
		drafts.open('thread');
		drafts.rename('b', 'dawn');
		drafts.open('lobby');
		expect(drafts.files.map(({ title }) => title)).toEqual(['dawn', 'sunset.jpg']);
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

	it('keeps the roles the open draft names, and whether it starts with /, replaced only as they change', () => {
		const drafts = new PaneDrafts();
		drafts.open('lobby');
		expect(drafts.roles).toEqual([]);
		drafts.text = 'ask @&moderator';
		const roles = drafts.roles;
		expect(roles).toEqual(['moderator']);
		drafts.text = 'ask @&moderator to look';
		expect(drafts.roles).toBe(roles);
		// A backtick may put it in code: the roles are given again, to be checked again.
		drafts.text = 'ask `@&moderator` to look';
		expect(drafts.roles).not.toBe(roles);
		expect(drafts.roles).toEqual(['moderator']);
		drafts.text = 'ask @&moderator and @&admin, not a@&b';
		expect(drafts.roles).toEqual(['moderator', 'admin']);
		drafts.open('dev');
		expect(drafts.roles).toEqual([]);
		drafts.text = '/shrug';
		expect(drafts.slashed).toBe(true);
		drafts.open('lobby');
		expect(drafts.roles).toEqual(['moderator', 'admin']);
		expect(drafts.slashed).toBe(false);
		drafts.clear('lobby');
		expect(drafts.roles).toEqual([]);
	});

	it('starts each pane from the draft its store kept, the first time, and hands it each change', () => {
		const kept = new Map<string, SavedDraft>([['lobby', { text: 'from before', reply: 'm1', dismissed: ['https://a.example/'] }]]);
		const store: DraftStore = { keeps: () => true, knows: () => true, load: (key) => kept.get(key), changed: (key, read) => void kept.set(key, read(key)) };
		const drafts = new PaneDrafts(store);
		drafts.open('lobby');
		expect([drafts.text, drafts.reply, drafts.dismissed]).toEqual(['from before', 'm1', ['https://a.example/']]);
		drafts.text = 'from before, and more';
		drafts.saveText();
		expect(kept.get('lobby')).toEqual({ text: 'from before, and more', reply: 'm1', dismissed: ['https://a.example/'] });
		// Removing a preview is a change too: what is read is the draft as shown.
		drafts.dismissed = [];
		expect(kept.get('lobby')?.dismissed).toEqual([]);
		// Kept for the visit: the store isn't asked again, even when it changes under it.
		kept.set('lobby', { text: 'another tab' });
		drafts.open('thread');
		drafts.open('lobby');
		expect(drafts.text).toBe('from before, and more');
		drafts.clear('lobby');
		expect(kept.get('lobby')).toEqual({ text: '', reply: undefined, dismissed: [] });
		// Kept text is no loss on reload: only files are.
		drafts.text = 'typing';
		expect(drafts.unsent).toBe(false);
		drafts.stage([staged('a')]);
		expect(drafts.unsent).toBe(true);
	});

	it('forgets the drafts of a session that signed out, the open one too', () => {
		const drafts = new PaneDrafts();
		drafts.open('a:lobby');
		drafts.text = 'mine';
		drafts.open('b:lobby');
		drafts.text = 'elsewhere';
		drafts.open('a:thread');
		drafts.text = 'open';
		drafts.forgetWhere((key) => key.startsWith('a:'));
		expect(drafts.text).toBe('');
		drafts.open('a:lobby');
		expect(drafts.text).toBe('');
		drafts.open('b:lobby');
		expect(drafts.text).toBe('elsewhere');
	});
});
