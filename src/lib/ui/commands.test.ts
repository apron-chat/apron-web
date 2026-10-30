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
		// Members are added and removed in the member list; the server has its own /kick and /invite-….
		expect(composerAction('/kick @guest_2', both)).toEqual({ kind: 'command', text: '/kick @guest_2' });
		expect(composerAction('/invite 3', both)).toEqual({ kind: 'command', text: '/invite 3' });
		// Without an argument, or without capability rooms, the server gets them.
		expect(composerAction('/nick', both)).toEqual({ kind: 'command', text: '/nick' });
		expect(composerAction('/join ops', { command: true, rooms: false })).toEqual({ kind: 'command', text: '/join ops' });
	});

	it('posts /me as an action in italics, with or without capability command', () => {
		expect(composerAction('/me waves ', both)).toEqual({ kind: 'message', text: '_waves_' });
		expect(composerAction('/ME shares #ops with @ada', { command: false, rooms: false })).toEqual({ kind: 'message', text: '_shares #ops with @ada_' });
		// Not an action: nothing to do, another command, more than one line, or //.
		expect(composerAction('/me', both)).toEqual({ kind: 'command', text: '/me' });
		expect(composerAction('/meet ada', both)).toEqual({ kind: 'command', text: '/meet ada' });
		expect(composerAction('/me waves\nthen leaves', both)).toEqual({ kind: 'command', text: '/me waves\nthen leaves' });
		expect(composerAction('//me waves', both)).toEqual({ kind: 'message', text: '/me waves' });
		expect(isCommand('/me waves')).toBe(false);
		expect(isCommand('/me')).toBe(true);
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
