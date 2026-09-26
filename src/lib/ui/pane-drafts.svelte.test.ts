import { describe, expect, it } from 'vitest';
import { PaneDrafts } from './pane-drafts.svelte';

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
});
