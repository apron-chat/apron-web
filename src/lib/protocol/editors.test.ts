import { describe, expect, it } from 'vitest';
import { editedBy, mayEditText, sharesText } from './editors';
import type { MessageRecord } from './types';

const message = (fields: Partial<MessageRecord> = {}): MessageRecord => ({
	message_id: '1', log_id: '2', room_id: 'general', from: { user_id: 'alice' },
	body: { text: '- [ ] soup', format: 'markdown', mentions: ['bob'] },
	ext: { editors: { 'body.text': 'mentioned' } },
	...fields
});

describe('ext:editors', () => {
	it('lets those a message mentions edit the text it shares, but not its sender as a sharer, nor anyone else', () => {
		expect(sharesText(message())).toBe(true);
		expect(mayEditText(message(), 'bob')).toBe(true);
		expect(mayEditText(message(), 'carol')).toBe(false);
		expect(mayEditText(message(), 'alice')).toBe(false);
		expect(mayEditText(message(), undefined)).toBe(false);
	});

	it('shares nothing without the grant, with a value it does not know, or once deleted', () => {
		expect(mayEditText(message({ ext: undefined }), 'bob')).toBe(false);
		expect(mayEditText(message({ ext: { editors: { 'body.text': 'everyone' } } }), 'bob')).toBe(false);
		expect(mayEditText(message({ ext: { editors: 'mentioned' } }), 'bob')).toBe(false);
		expect(mayEditText(message({ deleted: true }), 'bob')).toBe(false);
	});

	it('reads who saved a snapshot, when not its sender', () => {
		expect(editedBy(message())).toBeUndefined();
		expect(editedBy(message({ ext: { editors: { 'body.text': 'mentioned', edited_by: 'bob' } } }))).toBe('bob');
		expect(editedBy(message({ ext: { editors: { edited_by: 'alice' } } }))).toBeUndefined();
		expect(editedBy(message({ ext: { editors: { edited_by: 7 } } }))).toBeUndefined();
	});
});
