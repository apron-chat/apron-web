import { describe, expect, it } from 'vitest';
import type { MessageRecord } from '$lib/protocol/types';
import { messageLog } from './message-log';
import { idTime } from './time';

const names: Record<string, string> = { ada: 'Ada Lovelace', ben: 'Ben', cy: 'Cy' };
const nameOf = (event: MessageRecord) => names[event.from.user_id] ?? event.from.user_id;

/** A message at `minute` past 14:00 on 30 Oct 2026, local time. */
function at(minute: number, from: string, text: string, extra: Partial<MessageRecord> = {}): MessageRecord {
	const id = String(new Date(2026, 9, 30, 14, minute).getTime());
	return { message_id: id, log_id: id, room_id: 'ops', from: { user_id: from }, body: { text, format: 'markdown' }, ...extra };
}

describe('messageLog', () => {
	const now = new Date(2026, 9, 30, 18);

	it('heads each sender’s run with their name and time, dates the first, and quotes what a reply answers', () => {
		const deploy = at(2, 'ada', 'Deploy is green, rolling to **prod** now.');
		const pods = at(4, 'ben', 'Worker pods are restarting in a loop.', { reply_to: { message_id: deploy.message_id } });
		const crash = at(5, 'ben', 'Crash is in the new queue client:\n\n```\nTypeError: conn is undefined\n```');
		const rollback = at(20, 'cy', 'Rolled back worker to 1.8.3.', { reply_to: { message_id: pods.message_id } });
		const thanks = at(31, 'ada', 'Thanks both — retro at 16:00.', { body: { text: 'Thanks both — retro at 16:00.', embeds: [{ kind: 'og', url: 'https://meet.example/retro', og: { title: 'Retro' } }] } });
		const time = (event: MessageRecord) => idTime(event.message_id);
		expect(messageLog([deploy, pods, crash, rollback, thanks], { nameOf, now })).toBe([
			`**Ada Lovelace** · Fri, Oct 30, 2026, ${time(deploy)}`,
			'Deploy is green, rolling to **prod** now.',
			'',
			`**Ben** · ${time(pods)}`,
			'> **Ada Lovelace**: Deploy is green, rolling to prod now.',
			'',
			'Worker pods are restarting in a loop.',
			'',
			'Crash is in the new queue client:',
			'',
			'```',
			'TypeError: conn is undefined',
			'```',
			'',
			`**Cy** · ${time(rollback)}`,
			'> **Ben**: Worker pods are restarting in a loop.',
			'',
			'Rolled back worker to 1.8.3.',
			'',
			`**Ada Lovelace** · ${time(thanks)}`,
			'Thanks both — retro at 16:00.',
		].join('\n'));
	});

	it('quotes a reply’s target from outside the log when it can, and says so when it can’t', () => {
		const earlier = { ...at(0, 'cy', 'Who owns the queue client?'), message_id: 'old', log_id: 'old' };
		const answer = { ...at(1, 'ben', 'I do.', { reply_to: { message_id: 'old' } }), message_id: 'a', log_id: 'a' };
		const orphan = { ...at(2, 'ada', 'Agreed.', { reply_to: { message_id: 'gone' } }), message_id: 'b', log_id: 'b' };
		const lookup = (id: string) => (id === 'old' ? earlier : undefined);
		expect(messageLog([answer, orphan], { nameOf, lookup })).toBe([
			'**Ben**', '> **Cy**: Who owns the queue client?', '', 'I do.', '',
			'**Ada Lovelace**', '> _(reply to an earlier message)_', '', 'Agreed.',
		].join('\n'));
	});

	it('leaves out embeds, notes deleted and attachment-only messages, and keeps a name’s Markdown inert', () => {
		const id = (event: MessageRecord, value: string) => ({ ...event, message_id: value, log_id: value });
		const upload = id(at(0, 'ada', '', { body: { embeds: [{ kind: 'upload', url: 'https://cdn.example/a.png', title: 'a.png' }] } }), 'u');
		const gone = id(at(0, 'ben', '', { deleted: true, body: undefined }), 'd');
		const starry = id(at(0, '*star*', 'hi'), 's');
		expect(messageLog([upload, gone, starry], { nameOf })).toBe('**Ada Lovelace**\n_(attachment)_\n\n**Ben**\n_(deleted)_\n\n**\\*star\\***\nhi');
	});

	it('dates the first message in full, and each new day after with the year only when it isn’t this one', () => {
		const late = at(0, 'ada', 'Night.');
		const next = { ...late, message_id: String(new Date(2026, 9, 31, 9).getTime()), body: { text: 'Morning.' } };
		const thisYear = messageLog([late, next], { nameOf, now });
		expect(thisYear).toContain('**Ada Lovelace** · Fri, Oct 30, 2026, ');
		expect(thisYear).toContain('**Ada Lovelace** · Sat, Oct 31, ');
		expect(thisYear).not.toContain('Oct 31, 2026');
		const lastYear = messageLog([late, next], { nameOf, now: new Date(2027, 0, 1) });
		expect(lastYear).toContain('**Ada Lovelace** · Sat, Oct 31, 2026, ');
	});

	it('is empty for no messages', () => {
		expect(messageLog([])).toBe('');
	});
});
