import { describe, expect, it } from 'vitest';
import type { ServerCommand } from '$lib/protocol/command-list';
import { commandCompletion, commandInfo, mergeCommands, ownCommands } from './command-autocomplete';
import { commandQuery, type OfferedCommand } from './command-query';

/** The extension's example list (ext_command_list.md), in its order, with two more forms of `server`. */
const LISTED: ServerCommand[] = [
	{ name: 'approve', description: 'Approve the agent’s request that you reply to', uses: ['room_id', 'reply_to'], requires: ['reply_to'] },
	{ name: 'avatar', description: 'Set your avatar from one attached image', uses: ['body.embeds'], requires: ['body.embeds'] },
	{ name: 'embed-terminal', description: 'Get a link to stream a terminal into this room', hint: '[<title>]', uses: ['room_id', 'reply_to'] },
	{ name: 'emoji add', description: 'Add a custom emoji', hint: ':<name>:', uses: ['body.embeds'], requires: ['body.embeds'] },
	{ name: 'emoji remove', description: 'Remove a custom emoji', hint: ':<name>:' },
	{ name: 'help', description: 'List the commands that you can use' },
	{ name: 'kick', description: 'Remove a user from this room', hint: '@user [<reason>]', uses: ['room_id', 'body.mentions'], requires: ['body.mentions'] },
	{ name: 'server', description: 'Show this server’s title, description, and avatar' },
	{ name: 'server avatar', description: 'Set this server’s avatar', uses: ['body.embeds'] },
	{ name: 'server description', description: 'Set this server’s description', hint: '[<text>]' },
	{ name: 'server title', description: 'Set this server’s title', hint: '[<text>]' }
];

const complete = (text: string, context = {}, commands: readonly OfferedCommand[] = LISTED) => {
	const found = commandQuery(text, text.length);
	return found && commandCompletion(commands, found, context);
};
const names = (text: string, context = {}) => complete(text, context)?.suggestions.map((suggestion) => suggestion.name);

describe('commandQuery', () => {
	it('reads the words of a command up to the caret, one space apart, and where the word at the caret ends', () => {
		expect(commandQuery('/', 1)).toEqual({ typed: '', words: [], query: '', end: 1 });
		expect(commandQuery('/emo', 4)).toEqual({ typed: 'emo', words: [], query: 'emo', end: 4 });
		expect(commandQuery('/emoji a', 8)).toEqual({ typed: 'emoji a', words: ['emoji'], query: 'a', end: 8 });
		expect(commandQuery('/emoji ', 7)).toEqual({ typed: 'emoji ', words: ['emoji'], query: '', end: 7 });
		// The caret inside a word: a pick replaces the whole word.
		expect(commandQuery('/kicx @bob', 3)).toEqual({ typed: 'ki', words: [], query: 'ki', end: 5 });
	});

	it('reads none outside a command’s words: no command, `//`, a second line, two spaces, or the caret before the `/`', () => {
		expect(commandQuery('hello /x', 8)).toBeUndefined();
		expect(commandQuery('//kick', 6)).toBeUndefined();
		expect(commandQuery('/kick\nx', 7)).toBeUndefined();
		expect(commandQuery('/emoji  a', 9)).toBeUndefined();
		expect(commandQuery('/kick', 0)).toBeUndefined();
		expect(commandQuery(' /kick', 6)).toBeUndefined();
	});
});

describe('commandCompletion', () => {
	it('offers the first word of each command once, in the server’s order, and the forms after it once it is typed', () => {
		expect(names('/')).toEqual(['avatar', 'embed-terminal', 'emoji', 'help', 'kick', 'server']);
		expect(complete('/em')?.suggestions).toEqual([
			{ name: 'embed-terminal', hint: '[<title>]', description: 'Get a link to stream a terminal into this room', forms: [] },
			{ name: 'emoji', forms: ['add', 'remove'] }
		]);
		// A name that is the start of another is a command of its own, shown with its forms.
		expect(complete('/serv')?.suggestions).toEqual([{ name: 'server', description: 'Show this server’s title, description, and avatar', forms: ['avatar', 'description', 'title'] }]);
		// After the first word and a space: every command it starts, each an entry, with what it requires.
		expect(complete('/emoji ')?.suggestions).toEqual([
			{ name: 'emoji add', hint: ':<name>:', description: 'Add a custom emoji', required: ['attachment'] },
			{ name: 'emoji remove', hint: ':<name>:', description: 'Remove a custom emoji' }
		]);
		expect(names('/server ')).toEqual(['server', 'server avatar', 'server description', 'server title']);
		expect(names('/server av')).toEqual(['server avatar']);
		// Names are case-sensitive: the words before the caret match exactly, and the word at the caret suggests in any case.
		expect(names('/EMOJI R')).toBeUndefined();
		expect(names('/emoji R')).toEqual(['emoji remove']);
		expect(names('/EM')).toEqual(['embed-terminal', 'emoji']);
	});

	it('shows nothing once the words typed are arguments, but says when the first word matches none', () => {
		expect(complete('/kick ')).toBeUndefined();
		expect(complete('/emoji add ')).toBeUndefined();
		expect(complete('/emoji zap')).toBeUndefined();
		expect(complete('/nope ')).toBeUndefined();
		expect(complete('/nope')).toEqual({ suggestions: [], enter: false });
	});

	it('lets Enter take a suggestion only for a word partly typed that names no command yet', () => {
		expect(complete('/')?.enter).toBe(false);
		expect(complete('/emoji ')?.enter).toBe(false);
		expect(complete('/he')?.enter).toBe(true);
		// `/emoji` alone is no command: Enter puts in its forms. `/server` and `/help` are: Enter runs them.
		expect(complete('/emoji')?.enter).toBe(true);
		expect(complete('/server')?.enter).toBe(false);
		expect(complete('/help')?.enter).toBe(false);
		// `/HELP` names no command: Enter puts in `/help `.
		expect(complete('/HELP')?.enter).toBe(true);
	});

	it('offers a command that requires a reply only while replying, and puts first a word named exactly, then the commands that use a reply or files', () => {
		const exact: ServerCommand[] = [{ name: 'kicker', description: '' }, { name: 'kick', description: '' }];
		expect(complete('/kick', {}, exact)?.suggestions.map((suggestion) => suggestion.name)).toEqual(['kick', 'kicker']);
		expect(names('/a')).toEqual(['avatar']);
		expect(names('/a', { replying: true })).toEqual(['approve', 'avatar']);
		// Typed in full, it is still a command: Enter runs it, which the server may refuse.
		expect(complete('/approve')).toEqual({ suggestions: [], enter: false });
		expect(names('/', { replying: true })).toEqual(['approve', 'embed-terminal', 'avatar', 'emoji', 'help', 'kick', 'server']);
		// Files can come after a command's name: one that requires them is offered without them, first with them.
		expect(names('/', { attaching: true })).toEqual(['avatar', 'emoji', 'server', 'embed-terminal', 'help', 'kick']);
		expect(names('/', { replying: true, attaching: true })?.slice(0, 5)).toEqual(['approve', 'avatar', 'embed-terminal', 'emoji', 'server']);
	});
});

describe('the commands offered', () => {
	it('are apron-web’s own as it handles them, by what the server can do', () => {
		expect(ownCommands({ command: true, rooms: true, append: true }).map((command) => command.name)).toEqual(['nick', 'join', 'leave', 'topic', 'kick', 'invite', 'live']);
		expect(ownCommands({ command: true, rooms: true, members: false }).map((command) => command.name)).toEqual(['nick', 'join', 'leave', 'topic']);
		expect(ownCommands({ command: true, rooms: false }).map((command) => command.name)).toEqual(['nick']);
		expect(ownCommands({ command: true, rooms: true })[0]).toEqual({ name: 'nick', description: 'Change your display name', hint: '<name>', own: true });
		expect(ownCommands({ command: true, rooms: true }).find((command) => command.name === 'kick')?.hint).toBe('@user');
	});

	it('merge with the server’s, each name once, the server’s where both have it: the server’s order, then the rest of apron-web’s own', () => {
		const own = ownCommands({ command: true, rooms: true, append: true });
		const server: ServerCommand[] = [
			{ name: 'help', description: 'Help' },
			{ name: 'kick', description: 'The server’s kick, with a reason', hint: '@user [<reason>]' },
			{ name: 'Live', description: 'Another command than apron-web’s /live' }
		];
		const merged = mergeCommands(server, own)!;
		// `Live` is another name than `live`: names are case-sensitive. The server's `kick` sets apron-web's aside.
		expect(merged.map((command) => command.name)).toEqual(['help', 'kick', 'Live', 'nick', 'join', 'leave', 'topic', 'invite', 'live']);
		expect(merged[1]).toEqual(server[1]);
		expect(merged[8]).toEqual({ name: 'live', description: 'Type your next message live, for everyone to watch', own: true });
	});

	it('wait for the server’s, unless they won’t come', () => {
		const own = ownCommands({ command: true, rooms: false });
		expect(mergeCommands(undefined, own)).toBeUndefined();
		expect(mergeCommands(undefined, own, true)).toEqual([{ name: 'nick', description: 'Change your display name', hint: '<name>', own: true }]);
	});
});

describe('commandInfo', () => {
	const info = (text: string) => commandInfo(LISTED, text)?.name;

	it('names the command a draft names, by the longest name all of whose words start it, exactly, while its arguments are typed', () => {
		expect(info('/server avatar')).toBe('server avatar');
		expect(info('/server title My server')).toBe('server title');
		expect(info('/server')).toBe('server');
		expect(info('/kick @bob being rude\nand more')).toBe('kick');
		expect(commandInfo(LISTED, '/kick @bob')).toEqual({ name: 'kick', hint: '@user [<reason>]', description: 'Remove a user from this room', required: ['mention'] });
	});

	it('names none for a draft that names no command, or is no command', () => {
		expect(info('/nope arg')).toBeUndefined();
		expect(info('/emoji zap')).toBeUndefined();
		expect(info('/Kick @bob')).toBeUndefined();
		expect(info('//kick')).toBeUndefined();
		expect(info('kick')).toBeUndefined();
	});
});

