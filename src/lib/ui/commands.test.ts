import { describe, expect, it } from 'vitest';
import { composerAction, isCommand } from './commands';

const both = { command: true, rooms: true };

describe('composer commands', () => {
	it('sends text starting with one slash as a command, and // as a message with one slash stripped', () => {
		expect(isCommand('/help')).toBe(true);
		expect(isCommand('//etc/hosts')).toBe(false);
		expect(isCommand(' /help')).toBe(false);
		expect(composerAction('/kick @guest_2 spamming', both)).toEqual({ kind: 'command', text: '/kick @guest_2 spamming' });
		expect(composerAction('//etc/hosts is odd', both)).toEqual({ kind: 'message', text: '/etc/hosts is odd' });
		expect(composerAction('hello', both)).toEqual({ kind: 'message', text: 'hello' });
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
	});

	it('treats every text as a message without cap command', () => {
		const none = { command: false, rooms: true };
		expect(composerAction('/help', none)).toEqual({ kind: 'message', text: '/help' });
		expect(composerAction('//x', none)).toEqual({ kind: 'message', text: '//x' });
	});
});
