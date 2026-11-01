import { describe, expect, it } from 'vitest';
import { attachmentLimits, composerAction, isCommand } from './commands';

const both = { command: true, rooms: true };

describe('composer commands', () => {
	it('sends text starting with one slash as a command where the server takes commands, and // as a message with one slash stripped', () => {
		expect(isCommand('/help')).toBe(true);
		expect(isCommand('//etc/hosts')).toBe(false);
		expect(isCommand(' /help')).toBe(false);
		expect(composerAction('/kick @guest_2 spamming', both)).toEqual({ kind: 'command', text: '/kick @guest_2 spamming' });
		expect(composerAction('//etc/hosts is odd', both)).toEqual({ kind: 'message', text: '/etc/hosts is odd' });
		expect(composerAction('hello', both)).toEqual({ kind: 'message', text: 'hello' });
		// Without cap command, every text is a message.
		const none = { command: false, rooms: true };
		expect(composerAction('/help', none)).toEqual({ kind: 'message', text: '/help' });
		expect(composerAction('//x', none)).toEqual({ kind: 'message', text: '//x' });
	});

	it('handles the slash spellings of existing requests itself', () => {
		expect(composerAction('/nick Ada L', both)).toEqual({ kind: 'nick', name: 'Ada L' });
		expect(composerAction('/join #ops', both)).toEqual({ kind: 'join', room: 'ops' });
		expect(composerAction('/leave', both)).toEqual({ kind: 'leave' });
		expect(composerAction('/leave ops', both)).toEqual({ kind: 'leave', room: 'ops' });
		expect(composerAction('/TOPIC Deploys *only* ', both)).toEqual({ kind: 'topic', description: 'Deploys *only*' });
		expect(composerAction('/kick @guest_2', both)).toEqual({ kind: 'kick', user: 'guest_2' });
		expect(composerAction('/invite bob.', both)).toEqual({ kind: 'invite', user: 'bob' });
		// Without an argument, or without capability rooms, the server gets them.
		expect(composerAction('/nick', both)).toEqual({ kind: 'command', text: '/nick' });
		expect(composerAction('/join ops', { command: true, rooms: false })).toEqual({ kind: 'command', text: '/join ops' });
		// A reason, or a server that doesn't let members remove others, leaves /kick to the server.
		expect(composerAction('/kick @guest_2', { ...both, members: false })).toEqual({ kind: 'command', text: '/kick @guest_2' });
		expect(composerAction('/kick', both)).toEqual({ kind: 'command', text: '/kick' });
	});

	it('reads a user argument per Appendix A.3, and exactly as a mention chip names it', () => {
		// In text a trailing `-` is not part of the ID…
		expect(composerAction('/kick @al-', both)).toEqual({ kind: 'kick', user: 'al' });
		// …but a chip sent as `@al-` with `al-` in its mentions is that user.
		expect(composerAction('/kick @al-', both, ['al-'])).toEqual({ kind: 'kick', user: 'al-' });
		expect(composerAction('/kick @al', both, ['al'])).toEqual({ kind: 'kick', user: 'al' });
		// Email and federated forms are one ID.
		expect(composerAction('/kick @ada@example.com', both)).toEqual({ kind: 'kick', user: 'ada@example.com' });
		expect(composerAction('/invite carol:b.example.', both)).toEqual({ kind: 'invite', user: 'carol:b.example' });
	});
});

describe('/live', () => {
	it('is the client\'s own with embed:append, with or without command', () => {
		expect(composerAction('/live', { command: true, rooms: true, append: true })).toEqual({ kind: 'live' });
		expect(composerAction('/LIVE ', { command: false, rooms: false, append: true })).toEqual({ kind: 'live' });
	});

	it('goes as typed without embed:append, or with an argument', () => {
		expect(composerAction('/live', { command: true, rooms: true })).toEqual({ kind: 'command', text: '/live' });
		expect(composerAction('/live', { command: false, rooms: false })).toEqual({ kind: 'message', text: '/live' });
		expect(composerAction('/live now', { command: true, rooms: true, append: true })).toEqual({ kind: 'command', text: '/live now' });
	});
});

describe('attachmentLimits (ext:media)', () => {
	const upload = { 'image/*': { max_bytes: 5_242_880, max_side: 2048 } };
	const emoji = { 'image/png': { max_bytes: 262_144 }, 'image/gif': { max_bytes: 262_144 } };

	it('fits the files of `/emoji add` to the emoji category, and every other send to upload', () => {
		expect(attachmentLimits(composerAction('/emoji add :party:', both), { upload, emoji })).toBe(emoji);
		expect(attachmentLimits(composerAction('/EMOJI  Add\n:party:', both), { upload, emoji })).toBe(emoji);
		expect(attachmentLimits(composerAction('/emoji remove :party:', both), { upload, emoji })).toBe(upload);
		expect(attachmentLimits(composerAction('/emoji addendum', both), { upload, emoji })).toBe(upload);
		expect(attachmentLimits(composerAction('/avatar', both), { upload, emoji })).toBe(upload);
		expect(attachmentLimits(composerAction('//emoji add :party:', both), { upload, emoji })).toBe(upload);
		expect(attachmentLimits(composerAction('look: /emoji add', both), { upload, emoji })).toBe(upload);
		// Without cap command it is a message.
		expect(attachmentLimits(composerAction('/emoji add :party:', { command: false, rooms: true }), { upload, emoji })).toBe(upload);
	});

	it('keeps to upload, or to no limits, without an emoji category', () => {
		expect(attachmentLimits(composerAction('/emoji add :party:', both), { upload })).toBe(upload);
		expect(attachmentLimits(composerAction('/emoji add :party:', both), {})).toBeUndefined();
	});
});
