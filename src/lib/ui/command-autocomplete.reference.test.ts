import { describe, expect, it } from 'vitest';
import type { ServerCommand } from '$lib/protocol/command-list';
import { ownCommands, referenceSections } from './command-autocomplete';

/** The extension's example list (ext_command_list.md), with a command for room owners and one without a group. */
const LISTED: ServerCommand[] = [
	{ name: 'approve', group: 'member', description: 'Approve the agent’s request that you reply to', uses: ['room_id', 'reply_to'], requires: ['reply_to'] },
	{ name: 'avatar', group: 'member', description: 'Set your avatar from one attached image', uses: ['body.embeds'], requires: ['body.embeds'] },
	{ name: 'embed-terminal', group: 'all', description: 'Get a link to stream a terminal', hint: '[<title>]', uses: ['room_id', 'reply_to'] },
	{ name: 'emoji add', group: 'role', description: 'Add a custom emoji', hint: ':<name>:', uses: ['body.embeds'], requires: ['body.embeds'] },
	{ name: 'emoji remove', group: 'role', description: 'Remove a custom emoji', hint: ':<name>:' },
	{ name: 'help', group: 'all', description: 'List the commands that you can use' },
	{ name: 'kick', group: 'admin', description: 'Remove a user from this room', hint: '@user [<reason>]', uses: ['room_id', 'body.mentions'], requires: ['body.mentions'] },
	{ name: 'server title', group: 'admin', description: 'Set this server’s title', hint: '[<text>]' },
	{ name: 'server', group: 'admin', description: 'Show this server’s title' },
	{ name: 'pin', group: 'room', description: 'Pin a message in your room', uses: ['room_id', 'reply_to'] },
	{ name: 'roll', description: 'Roll dice', hint: '<n>d<sides>' }
];
const OWN = ownCommands({ command: true, rooms: true, append: true });
const sections = (server = LISTED) => referenceSections(server, OWN);
const outline = () => sections().map((section) => [section.title, section.commands.map((command) => (command.replaced ? `~${command.name}~` : command.name))]);

describe('referenceSections', () => {
	it('heads each group, widest first, then the server’s commands without one, then apron-web’s own; each in its order, a form like any', () => {
		expect(outline()).toEqual([
			['Everyone', ['embed-terminal', 'help']],
			['Members', ['approve', 'avatar']],
			['Room owners', ['pin']],
			['Roles', ['emoji add', 'emoji remove']],
			['Admins', ['kick', 'server title', 'server']],
			['Other', ['roll']],
			// The server's `kick` takes the place of apron-web's own, which stays listed, crossed out.
			['Built into the client', ['nick', 'join', 'leave', 'topic', '~kick~', 'invite', 'live']]
		]);
		// Without a group anywhere, the server's are one section; without a server command of its name, none is crossed out.
		expect(referenceSections([{ name: 'help', description: 'Help' }], OWN).map((section) => [section.title, section.commands.filter((command) => command.replaced).length])).toEqual([['Server', 0], ['Built into the client', 0]]);
	});

	it('gives each command its hint and description as written, and what it requires, by name, in one order', () => {
		const all = sections().flatMap((section) => section.commands);
		const find = (name: string) => all.find((command) => command.name === name && !command.replaced);
		expect(find('emoji add')).toEqual({ name: 'emoji add', hint: ':<name>:', description: 'Add a custom emoji', required: ['attachment'] });
		expect(find('approve')?.required).toEqual(['reply']);
		expect(find('kick')?.required).toEqual(['mention']);
		// Only what it requires: `embed-terminal` uses a reply, and requires nothing.
		expect(find('embed-terminal')?.required).toBeUndefined();
		// Acting on the room it's sent in: said so, apart from what it requires; where there's no room, one that requires
		// it can't be used, and says so.
		expect(find('kick')?.inRoom).toBe(true);
		const roomed: ServerCommand[] = [{ name: 'embed-terminal', description: 'Stream', uses: ['room_id'], requires: ['room_id'] }];
		expect(referenceSections(roomed, [], { room: true })[0].commands[0]).toEqual({ name: 'embed-terminal', description: 'Stream', inRoom: true });
		expect(referenceSections(roomed, [], { room: false })[0].commands[0]).toEqual({ name: 'embed-terminal', description: 'Stream', inRoom: true, noRoom: true });
		const both = referenceSections([{ name: 'x', description: 'X', uses: ['body.embeds', 'reply_to', 'body.mentions'], requires: ['body.embeds', 'reply_to', 'body.mentions'] }], []);
		expect(both[0].commands[0].required).toEqual(['reply', 'mention', 'attachment']);
	});
});
