import { describe, expect, it } from 'vitest';
import type { ServerCommand } from '$lib/protocol/command-list';
import { mergeCommands, ownCommands } from './command-autocomplete';
import { paletteSections } from './command-palette';

/** The extension's example list (ext_command_list.md), with a command for room owners and one without a group. */
const LISTED: ServerCommand[] = [
	{ name: 'approve', group: 'member', description: 'Approve the agent’s request that you reply to', uses: ['room_id', 'reply_to'], requires: ['reply_to'] },
	{ name: 'avatar', group: 'member', description: 'Set your avatar from one attached image', uses: ['body.embeds'], requires: ['body.embeds'] },
	{ name: 'embed-terminal', group: 'all', description: 'Get a link to stream a terminal', hint: '[<title>]', uses: ['room_id', 'reply_to'] },
	{ name: 'emoji add', group: 'role', description: 'Add a custom emoji', hint: ':<name>:', uses: ['body.embeds'], requires: ['body.embeds'] },
	{ name: 'emoji remove', group: 'role', description: 'Remove a custom emoji', hint: ':<name>:' },
	{ name: 'help', group: 'all', description: 'List the commands that you can use' },
	{ name: 'kick', group: 'admin', description: 'Remove a user from this room', hint: '@user [<reason>]', uses: ['room_id', 'body.mentions'], requires: ['body.mentions'] },
	{ name: 'server', group: 'admin', description: 'Show this server’s title' },
	{ name: 'server title', group: 'admin', description: 'Set this server’s title', hint: '[<text>]' },
	{ name: 'pin', group: 'room', description: 'Pin a message in your room', uses: ['room_id', 'reply_to'] },
	{ name: 'roll', description: 'Roll dice', hint: '<n>d<sides>' }
];
const COMMANDS = mergeCommands(LISTED, ownCommands({ command: true, rooms: true, append: true }))!;
const titles = (query = '', context = {}) => paletteSections(COMMANDS, query, context).map((section) => section.title);
const names = (query = '', context = {}) => paletteSections(COMMANDS, query, context).map((section) => [section.title, section.rows.map((row) => (row.form ? `  ${row.name}` : row.name))]);

describe('paletteSections', () => {
	it('shows the groups widest first, then the server’s commands without one, then apron-web’s own; each in its order', () => {
		expect(titles()).toEqual(['Everyone', 'Members', 'Room owners', 'Roles', 'Admins', 'Other', 'Built in']);
		expect(names()).toEqual([
			['Everyone', ['embed-terminal', 'help']],
			['Members', ['approve', 'avatar']],
			['Room owners', ['pin']],
			['Roles', ['emoji', '  emoji add', '  emoji remove']],
			// `kick` is apron-web’s own: it shows there, once.
			['Admins', ['server', '  server title']],
			['Other', ['roll']],
			['Built in', ['kick', 'nick', 'join', 'leave', 'topic', 'invite', 'live']]
		]);
		// Without a group anywhere, the server's are one section.
		const plain = paletteSections(mergeCommands([{ name: 'help', description: 'Help' }], [])!, '');
		expect(plain).toEqual([{ title: 'Server', rows: [{ name: 'help', description: 'Help' }] }]);
	});

	it('shows a command’s hint and description as written, and greys one whose requires doesn’t fit now, with why', () => {
		const rows = paletteSections(COMMANDS, '').flatMap((section) => section.rows);
		expect(rows.find((row) => row.name === 'emoji add')).toEqual({ name: 'emoji add', hint: ':<name>:', description: 'Add a custom emoji', form: true, unfit: 'Attach a file first' });
		expect(rows.find((row) => row.name === 'approve')?.unfit).toBe('Reply to a message first');
		// Mentions come with what's typed after the name: never why.
		expect(rows.find((row) => row.name === 'kick')?.unfit).toBeUndefined();
		const fitting = paletteSections(COMMANDS, '', { replying: true, attaching: true }).flatMap((section) => section.rows);
		expect(fitting.filter((row) => row.unfit)).toEqual([]);
	});

	it('narrows by name or description, in any case, with or without the /, keeping a form under its first word', () => {
		expect(names('/emoji A')).toEqual([['Roles', ['emoji', '  emoji add']]]);
		expect(names('title')).toEqual([['Admins', ['server', '  server title']]]);
		expect(names('dice')).toEqual([['Other', ['roll']]]);
		expect(names('nothing like it')).toEqual([]);
	});
});
