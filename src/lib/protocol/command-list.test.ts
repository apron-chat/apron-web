import { describe, expect, it } from 'vitest';
import { parseCommandList } from './command-list';

describe('parseCommandList', () => {
	it('keeps the commands in their order, with their hint and params, and a name as words one space apart', () => {
		expect(parseCommandList({
			commands: [
				{ name: 'kick', description: 'Remove a user from this room', hint: '@user [<reason>]', uses: ['room_id', 'body.mentions'], requires: ['body.mentions'] },
				{ name: ' emoji   add ', description: 'Add a custom emoji', hint: ':<name>:', uses: ['body.embeds'], requires: ['body.embeds'] },
				{ name: 'help', description: 'List the commands that you can use' }
			]
		})).toEqual([
			{ name: 'kick', description: 'Remove a user from this room', hint: '@user [<reason>]', uses: ['room_id', 'body.mentions'], requires: ['body.mentions'] },
			{ name: 'emoji add', description: 'Add a custom emoji', hint: ':<name>:', uses: ['body.embeds'], requires: ['body.embeds'] },
			{ name: 'help', description: 'List the commands that you can use' }
		]);
	});

	it('gives a field of the wrong type its default, ignores fields it doesn’t know, and leaves out an entry without a name it can offer', () => {
		expect(parseCommandList({
			commands: [
				{ name: 'a', description: 7, hint: ['x'], uses: 'room_id', requires: {} },
				{ name: 'b', description: 'B', hint: '  ', uses: ['reply_to', 3, null, 'embeds', 'reply_to', 'body.thread'], requires: ['body.mentions'] },
				{ description: 'no name' },
				{ name: '   ', description: 'blank' },
				{ name: '/slash', description: 'would be typed //' },
				{ name: 'b', description: 'listed before' },
				{ name: 'A', description: 'another name: names are case-sensitive' },
				'help',
				null
			]
		})).toEqual([
			{ name: 'a', description: '' },
			// What `requires` names, `uses` names too.
			{ name: 'b', description: 'B', uses: ['reply_to', 'body.mentions'], requires: ['body.mentions'] },
			{ name: 'A', description: 'another name: names are case-sensitive' }
		]);
		expect(parseCommandList({})).toEqual([]);
		expect(parseCommandList({ commands: { help: {} } })).toEqual([]);
	});

	it('keeps the group of each command it knows, and treats any other as none', () => {
		const groups = ['all', 'guest', 'member', 'room', 'role', 'admin', 'owner', 7, ''];
		expect(parseCommandList({ commands: groups.map((group, index) => ({ name: `c${index}`, description: 'd', group })) }).map((command) => command.group))
			.toEqual(['all', 'guest', 'member', 'room', 'role', 'admin', undefined, undefined, undefined]);
	});
});
