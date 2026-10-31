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

	it('quotes each sender’s run under their name and time, dates the first, and says what a reply answers', () => {
		const deploy = at(2, 'ada', 'Deploy is green, rolling to **prod** now.');
		const pods = at(4, 'ben', 'Worker pods are restarting in a loop.', { reply_to: { message_id: deploy.message_id } });
		const crash = at(5, 'ben', 'Crash is in the new queue client:\n\n```\nTypeError: conn is undefined\n```');
		const rollback = at(20, 'cy', 'Rolled back worker to 1.8.3.', { reply_to: { message_id: pods.message_id } });
		const thanks = at(31, 'ada', 'Thanks both — retro at 16:00.', { body: { text: 'Thanks both — retro at 16:00.', embeds: [{ kind: 'og', url: 'https://meet.example/retro', og: { title: 'Retro' } }] } });
		const time = (event: MessageRecord) => idTime(event.message_id);
		expect(messageLog([deploy, pods, crash, rollback, thanks], { nameOf, now })).toBe([
			`> **Ada Lovelace** · Friday, Oct 30, 2026 at ${time(deploy)}`,
			'>',
			'> Deploy is green, rolling to **prod** now.',
			'',
			`> **Ben** · ${time(pods)}`,
			'>',
			'> > ↪ **Ada Lovelace**: Deploy is green, rolling to prod now.',
			'>',
			'> Worker pods are restarting in a loop.',
			'>',
			'> Crash is in the new queue client:',
			'>',
			'> ```',
			'> TypeError: conn is undefined',
			'> ```',
			'',
			`> **Cy** · ${time(rollback)}`,
			'>',
			'> > ↪ **Ben**: Worker pods are restarting in a loop.',
			'>',
			'> Rolled back worker to 1.8.3.',
			'',
			`> **Ada Lovelace** · ${time(thanks)}`,
			'>',
			'> Thanks both — retro at 16:00.',
		].join('\n'));
	});

	it('names a reply’s target from outside the log when it can, says so when it can’t, and keeps the snippet’s Markdown inert', () => {
		const earlier = { ...at(0, 'cy', 'Who owns the *queue* client?'), message_id: 'old', log_id: 'old' };
		const answer = { ...at(1, 'ben', 'I do.', { reply_to: { message_id: 'old' } }), message_id: 'a', log_id: 'a' };
		const orphan = { ...at(2, 'ada', 'Agreed.', { reply_to: { message_id: 'gone' } }), message_id: 'b', log_id: 'b' };
		const echo = { ...at(3, 'cy', 'It’s mine.', { reply_to: { message_id: 'c' } }), message_id: 'c2', log_id: 'c2' };
		const plain = { ...at(3, 'ben', 'run `make` _now_', { body: { text: 'run `make` _now_', format: 'plain' } }), message_id: 'c', log_id: 'c' };
		const lookup = (id: string) => (id === 'old' ? earlier : undefined);
		expect(messageLog([answer, orphan, plain, echo], { nameOf, lookup })).toBe([
			'> **Ben**', '>', '> > ↪ **Cy**: Who owns the queue client?', '>', '> I do.', '',
			'> **Ada Lovelace**', '>', '> > ↪ _(an earlier message)_', '>', '> Agreed.', '',
			'> **Ben**', '>', '> run `make` _now_', '',
			'> **Cy**', '>', '> > ↪ **Ben**: run \\`make\\` \\_now\\_', '>', '> It’s mine.',
		].join('\n'));
	});

	it('ends a reply’s snippet in … wherever it leaves later lines out, and leaves a mid-line > as written', () => {
		const plan = { ...at(0, 'ada', 'Two options:\n\n- popup -> passkey\n- copy a code'), message_id: 'p', log_id: 'p' };
		const pick = { ...at(10, 'ben', 'The first.', { reply_to: { message_id: 'p' } }), message_id: 'q', log_id: 'q' };
		const arrow = { ...at(11, 'cy', 'popup -> passkey'), message_id: 'r', log_id: 'r' };
		const agree = { ...at(20, 'ada', 'Yes.', { reply_to: { message_id: 'r' } }), message_id: 's', log_id: 's' };
		const log = messageLog([plan, pick, arrow, agree], { nameOf });
		expect(log).toContain('> > ↪ **Ada Lovelace**: Two options:…\n');
		expect(log).toContain('> > ↪ **Cy**: popup -> passkey\n');
	});

	it('notes deleted and attachment-only messages, and keeps a name’s Markdown inert', () => {
		const id = (event: MessageRecord, value: string) => ({ ...event, message_id: value, log_id: value });
		const upload = id(at(0, 'ada', '', { body: { embeds: [{ kind: 'upload', url: 'https://cdn.example/a.pdf', title: 'a.pdf' }] } }), 'u');
		const gone = id(at(0, 'ben', '', { deleted: true, body: undefined }), 'd');
		const starry = id(at(0, '*star*', 'hi'), 's');
		expect(messageLog([upload, gone, starry], { nameOf })).toBe('> **Ada Lovelace**\n>\n> _(attachment)_\n\n> **Ben**\n>\n> _(deleted)_\n\n> **\\*star\\***\n>\n> hi');
	});

	it('lists a message’s reactions after its sender’s name, heading it and the message after on their own', () => {
		const first = at(0, 'ada', 'One.');
		const second = at(1, 'ada', 'Two.');
		const third = at(2, 'ada', 'Three.');
		const fourth = at(3, 'ada', 'Four.');
		const user = (id: string) => ({ user_id: id });
		const summary = (emoji: string, users: string[], count = users.length) => ({ emoji, count, user_ids: users, users: users.map(user), mine: false });
		const reactions = (event: MessageRecord) => event === second
			? [summary('👍', ['ben', 'cy']), summary('👎', ['ada']), summary('🎉', [], 0), summary(':party_parrot:', ['ben'], 3)]
			: event === third ? [summary('👀', [], 2)] : undefined;
		const time = (event: MessageRecord) => idTime(event.message_id);
		expect(messageLog([first, second, third, fourth], { nameOf, now, reactions, reactorName: (who) => names[who.user_id] })).toBe([
			`> **Ada Lovelace** · Friday, Oct 30, 2026 at ${time(first)}`, '>', '> One.', '',
			`> **Ada Lovelace** · ${time(second)} (👍 from Ben, Cy; 👎 from Ada Lovelace; :party\\_parrot: from Ben, 2 more)`, '>', '> Two.', '',
			`> **Ada Lovelace** · ${time(third)} (👀 from 2 people)`, '>', '> Three.', '',
			`> **Ada Lovelace** · ${time(fourth)}`, '>', '> Four.',
		].join('\n'));
	});

	it('says how many messages a gap leaves out, and heads the message after it', () => {
		const ids = ['1', '2', '3', '4', '5', '6'];
		const message = (id: string, text: string) => ({ ...at(Number(id), 'ada', text), message_id: id, log_id: id });
		const order = ids.map((id) => String(new Date(2026, 9, 30, 14, Number(id)).getTime()));
		const [one, three, four, six] = [message('1', 'One.'), message('3', 'Three.'), message('4', 'Four.'), message('6', 'Six.')].map((event, index) => ({ ...event, message_id: order[[0, 2, 3, 5][index]] }));
		const time = (event: MessageRecord) => idTime(event.message_id);
		expect(messageLog([one, three, four, six], { nameOf, now, order })).toBe([
			`> **Ada Lovelace** · Friday, Oct 30, 2026 at ${time(one)}`, '>', '> One.', '',
			'_(1 message omitted)_', '',
			`> **Ada Lovelace** · ${time(three)}`, '>', '> Three.', '>', '> Four.', '',
			'_(1 message omitted)_', '',
			`> **Ada Lovelace** · ${time(six)}`, '>', '> Six.',
		].join('\n'));
		expect(messageLog([one, four], { nameOf, now, order })).toContain('\n\n_(2 messages omitted)_\n\n');
		// Without `order`, or for a message it doesn't list, nothing is said to be left out.
		expect(messageLog([one, six], { nameOf, now })).not.toContain('omitted');
		expect(messageLog([one, message('x', 'Elsewhere.')], { nameOf, now, order })).not.toContain('omitted');
	});

	it('keeps a sender’s messages a few minutes apart in one quote', () => {
		const first = at(0, 'ada', 'One.');
		const second = at(2, 'ada', 'Two,\nstill two.');
		expect(messageLog([first, second], { nameOf, now })).toBe(`> **Ada Lovelace** · Friday, Oct 30, 2026 at ${idTime(first.message_id)}\n>\n> One.\n>\n> Two,\n> still two.`);
	});

	it('dates the first message in full, and each new day after with the year only when it isn’t this one', () => {
		const late = at(0, 'ada', 'Night.');
		const next = { ...late, message_id: String(new Date(2026, 9, 31, 9).getTime()), body: { text: 'Morning.' } };
		const thisYear = messageLog([late, next], { nameOf, now });
		expect(thisYear).toContain('> **Ada Lovelace** · Friday, Oct 30, 2026 at ');
		expect(thisYear).toContain('> **Ada Lovelace** · Saturday, Oct 31 at ');
		const lastYear = messageLog([late, next], { nameOf, now: new Date(2027, 0, 1) });
		expect(lastYear).toContain('> **Ada Lovelace** · Saturday, Oct 31, 2026 at ');
	});

	it('shows each message once, as its latest snapshot, where it first came', () => {
		const first = at(0, 'ada', 'Deploy is gren', { message_id: 'm1', log_id: '10' });
		const other = at(1, 'ben', 'On it.', { message_id: 'm2', log_id: '11' });
		const edited = { ...first, log_id: '12', body: { text: 'Deploy is green' } };
		const stale = { ...first, log_id: '9', body: { text: 'Deploy' } };
		expect(messageLog([first, other, edited, stale], { nameOf })).toBe('> **Ada Lovelace**\n>\n> Deploy is green\n\n> **Ben**\n>\n> On it.');
	});

	it('adds uploaded images as Markdown images, and leaves out uploads still going, other files and link previews', () => {
		const image = (url: string, title = 'image.webp') => ({ kind: 'upload', title, url, og: { title, image: { url, type: 'image/webp' } } });
		const shot = at(0, 'cy', 'stateless components ftw', { message_id: 'i', log_id: 'i', body: { text: 'stateless components ftw', embeds: [image('https://media.example/f/a'), { kind: 'og', url: 'https://example.com', og: { title: 'Example', image: { url: 'https://example.com/card.png' } } }] } });
		const alone = at(0, 'cy', '', { message_id: 'j', log_id: 'j', body: { embeds: [image('https://media.example/f/(b)', 'a [b]\nc')] } });
		const pending = at(0, 'cy', '', { message_id: 'k', log_id: 'k', body: { embeds: [{ kind: 'upload', title: 'image.webp' }, { kind: 'upload', title: 'notes.pdf', url: 'https://media.example/f/c' }] } });
		expect(messageLog([shot, alone, pending], { nameOf })).toBe([
			'> **Cy**', '>', '> stateless components ftw', '>', '> ![image.webp](https://media.example/f/a)', '',
			'> **Cy**', '>', '> ![a \\[b\\] c](https://media.example/f/%28b%29)', '',
			'> **Cy**', '>', '> _(attachment)_',
		].join('\n'));
	});

	it('renders as HTML for a rich paste, its images shown', () => {
		const html = messageLogHtml('> **Cy**\n>\n> > ↪ **Ben**: hi\n>\n> ok\n>\n> ![shot](https://media.example/f/a)');
		expect(html).toContain('<blockquote>');
		expect(html).toContain('<strong>Cy</strong>');
		expect(html).toContain('<blockquote>\n<p>↪ <strong>Ben</strong>: hi</p>\n</blockquote>');
		expect(html).toContain('<img src="https://media.example/f/a" alt="shot"');
	});

	it('is empty for no messages', () => {
		expect(messageLog([])).toBe('');
	});
});
