import { describe, expect, it } from 'vitest';
import { attachmentLimits, composerAction, isCommand } from './commands';
import { ownCommands } from './command-autocomplete';

const both = { command: true, rooms: true };

describe('apron-web’s own commands, and the server’s by the same name (ext:command_list)', () => {
	const all = { command: true, rooms: true, members: true, append: true };
	/** One draft for each of apron-web's own, as `ownCommands` lists them. */
	const OWN: Record<string, string> = { nick: '/nick Ada', join: '/join #general', leave: '/leave', topic: '/topic Hi', kick: '/kick @bob', invite: '/invite @bob', live: '/live' };

	it('handles each of the commands it offers as its own (`ownCommands`), and no other', () => {
		expect(ownCommands(all).map((command) => command.name)).toEqual(Object.keys(OWN));
		for (const [name, draft] of Object.entries(OWN)) expect(composerAction(draft, all).kind, draft).toBe(name);
	});

	it('sends one the server lists by the same name to the server, exactly by name, and handles it again once it doesn’t', () => {
		// As `LoadedCommands.serves` reads a listed name: all of its words lead the draft.
		const listed = ['kick', 'live', 'join', 'topic clear'];
		const serves = (text: string) => listed.some((name) => name.split(' ').every((word, index) => text.split(/\s+/)[index] === word));
		expect(composerAction('/kick @bob', { ...all, serves })).toEqual({ kind: 'command', text: '/kick @bob' });
		expect(composerAction('/live', { ...all, serves })).toEqual({ kind: 'command', text: '/live' });
		expect(composerAction('/join #general', { ...all, serves })).toEqual({ kind: 'command', text: '/join #general' });
		expect(composerAction('/invite @bob', { ...all, serves })).toEqual({ kind: 'invite', user: 'bob' });
		// A form of one of apron-web's names: the server's when it lists that form, apron-web's own otherwise.
		expect(composerAction('/topic clear', { ...all, serves })).toEqual({ kind: 'command', text: '/topic clear' });
		expect(composerAction('/topic Ship it', { ...all, serves })).toEqual({ kind: 'topic', description: 'Ship it' });
		// Names are case-sensitive: `/KICK` is neither the server's `kick` nor apron-web's, and goes to the server as typed.
		expect(composerAction('/KICK @bob', { ...all, serves })).toEqual({ kind: 'command', text: '/KICK @bob' });
		expect(composerAction('/LIVE', all)).toEqual({ kind: 'command', text: '/LIVE' });
		expect(composerAction('/Nick Ada', { ...all, serves })).toEqual({ kind: 'command', text: '/Nick Ada' });
		expect(composerAction('/kick @bob', { ...all, serves: () => false })).toEqual({ kind: 'kick', user: 'bob' });
		// Without `command`, none goes to the server; `/live` stays apron-web's.
		expect(composerAction('/live', { command: false, rooms: false, append: true, serves })).toEqual({ kind: 'live' });
	});
});

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
		expect(composerAction('/topic Deploys *only* ', both)).toEqual({ kind: 'topic', description: 'Deploys *only*' });
		// Names are case-sensitive, with or without ext:command_list: another spelling goes to the server.
		expect(composerAction('/TOPIC Deploys', both)).toEqual({ kind: 'command', text: '/TOPIC Deploys' });
		expect(composerAction('/NICK Ada', both)).toEqual({ kind: 'command', text: '/NICK Ada' });
		expect(composerAction('/Join #ops', both)).toEqual({ kind: 'command', text: '/Join #ops' });
		expect(composerAction('/kick @guest_2', both)).toEqual({ kind: 'kick', user: 'guest_2' });
		expect(composerAction('/invite bob.', both)).toEqual({ kind: 'invite', user: 'bob' });
		// Without an argument, or without capability rooms, the server gets them.
		expect(composerAction('/nick', both)).toEqual({ kind: 'command', text: '/nick' });
		expect(composerAction('/join ops', { command: true, rooms: false })).toEqual({ kind: 'command', text: '/join ops' });
		// A reason, or a server that doesn't let members remove others, leaves /kick to the server.
		expect(composerAction('/kick @guest_2', { ...both, members: false })).toEqual({ kind: 'command', text: '/kick @guest_2' });
		expect(composerAction('/kick', both)).toEqual({ kind: 'command', text: '/kick' });
		// A server's own commands go to it as typed, such as admitting someone from its lobby.
		expect(composerAction('/welcome @guest_2', both, ['guest_2'])).toEqual({ kind: 'command', text: '/welcome @guest_2' });
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
		expect(composerAction('/live ', { command: false, rooms: false, append: true })).toEqual({ kind: 'live' });
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
		expect(attachmentLimits(composerAction('/emoji  add\n:party:', both), { upload, emoji })).toBe(emoji);
		// Names are case-sensitive: `/EMOJI Add` is no `emoji add`.
		expect(attachmentLimits(composerAction('/EMOJI Add :party:', both), { upload, emoji })).toBe(upload);
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
