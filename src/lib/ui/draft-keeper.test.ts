import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DraftKeeper } from './draft-keeper';
import { loadDrafts, saveDrafts } from './storage';
import { memoryStorage } from '$lib/test/storage';

const values = new Map<string, string>();
const ada = 'wss://chat.example\nada';

beforeEach(() => {
	vi.stubGlobal('localStorage', memoryStorage(values));
});

afterEach(() => {
	values.clear();
	vi.unstubAllGlobals();
});

describe('DraftKeeper', () => {
	it('gives back what is kept for the account, and writes nothing before it starts', () => {
		saveDrafts(ada, { general: { text: 'kept', reply: '9' } });
		const keeper = new DraftKeeper();
		keeper.keep([['ops', { text: 'too early' }]]);
		expect(loadDrafts(ada)).toEqual({ general: { text: 'kept', reply: '9' } });
		expect(keeper.start(ada)).toEqual([['general', { text: 'kept', reply: '9' }]]);
		expect(keeper.active).toBe(true);
	});

	it('writes only what changed since it last read or wrote it, so another tab\'s drafts stay', () => {
		const keeper = new DraftKeeper();
		keeper.start(ada);
		// Another tab keeps a draft in ops after this one started; this tab has ops open, empty, all along.
		saveDrafts(ada, { ops: { text: 'from the other tab' } });
		keeper.keep([['ops', { text: '' }], ['general', { text: 'mine', reply: undefined }]]);
		expect(loadDrafts(ada)).toEqual({ ops: { text: 'from the other tab' }, general: { text: 'mine' } });
		// Unchanged since written: nothing is written again.
		values.delete('apron.drafts');
		keeper.keep([['general', { text: 'mine' }]]);
		expect(values.has('apron.drafts')).toBe(false);
	});

	it('drops a draft once sent or emptied, and keeps one that is only a reply', () => {
		const keeper = new DraftKeeper();
		keeper.start(ada);
		keeper.keep([['general', { text: 'hi' }], ['ops', { text: '', reply: '12' }]]);
		expect(loadDrafts(ada)).toEqual({ general: { text: 'hi' }, ops: { text: '', reply: '12' } });
		keeper.keep([['general', { text: '' }], ['ops', { text: '  ' }]]);
		expect(loadDrafts(ada)).toEqual({});
	});

	it('keeps nothing once stopped', () => {
		const keeper = new DraftKeeper();
		keeper.start(ada);
		keeper.stop();
		keeper.keep([['general', { text: 'after' }]]);
		expect(keeper.active).toBe(false);
		expect(loadDrafts(ada)).toEqual({});
	});
});
