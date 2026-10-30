// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { MessageRecord } from '$lib/protocol/types';
import { messageLog, messageLogHtml } from './message-log';
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

	it('shows each message once, as its latest snapshot, where it first came', () => {
		const first = at(0, 'ada', 'Deploy is gren', { message_id: 'm1', log_id: '10' });
		const other = at(1, 'ben', 'On it.', { message_id: 'm2', log_id: '11' });
		const edited = { ...first, log_id: '12', body: { text: 'Deploy is green' } };
		const stale = { ...first, log_id: '9', body: { text: 'Deploy' } };
		expect(messageLog([first, other, edited, stale], { nameOf })).toBe('**Ada Lovelace**\nDeploy is green\n\n**Ben**\nOn it.');
	});

	it('adds uploaded images as Markdown images, and leaves out uploads still going, other files and link previews', () => {
		const image = (url: string, title = 'image.webp') => ({ kind: 'upload', title, url, og: { title, image: { url, type: 'image/webp' } } });
		const shot = at(0, 'cy', 'stateless components ftw', { message_id: 'i', log_id: 'i', body: { text: 'stateless components ftw', embeds: [image('https://media.example/f/a'), { kind: 'og', url: 'https://example.com', og: { title: 'Example', image: { url: 'https://example.com/card.png' } } }] } });
		const alone = at(0, 'cy', '', { message_id: 'j', log_id: 'j', body: { embeds: [image('https://media.example/f/(b)', 'a [b]\nc')] } });
		const pending = at(0, 'cy', '', { message_id: 'k', log_id: 'k', body: { embeds: [{ kind: 'upload', title: 'image.webp' }, { kind: 'upload', title: 'notes.pdf', url: 'https://media.example/f/c' }] } });
		expect(messageLog([shot, alone, pending], { nameOf })).toBe([
			'**Cy**', 'stateless components ftw', '', '![image.webp](https://media.example/f/a)', '',
			'**Cy**', '![a \\[b\\] c](https://media.example/f/%28b%29)', '',
			'**Cy**',
			'_(attachment)_',
		].join('\n'));
	});

	it('renders as HTML for a rich paste, its images shown', () => {
		const html = messageLogHtml('**Cy**\n> **Ben**: hi\n\nok\n\n![shot](https://media.example/f/a)');
		expect(html).toContain('<strong>Cy</strong>');
		expect(html).toContain('<blockquote>');
		expect(html).toContain('<img src="https://media.example/f/a" alt="shot"');
	});

	it('is empty for no messages', () => {
		expect(messageLog([])).toBe('');
	});
});
