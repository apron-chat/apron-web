import type { ServerCommand } from '$lib/protocol/command-list';
import type { CommandCompletion, CommandContext, CommandEntry, CommandQuery, CommandSuggestion } from './command-query';

export type { CommandCompletion, CommandContext, CommandEntry, CommandOffer, CommandQuery, CommandSuggestion } from './command-query';

/**
 * The composer's command autocomplete (extension `ext:command_list`): the commands a `/` at the draft's start can
 * name, the server's and apron-web's own (`ownCommands`). Commands whose names start with the same word are forms of
 * one command (`emoji add`, `emoji remove`): the first word is offered once, and its forms once it is typed. Loaded
 * with the commands, on demand (`command-tools.ts`); `command-query.ts` holds what loads with the app, which this
 * imports only types from, so as not to split it into a chunk of its own.
 */

/** The most suggestions listed at once; the list scrolls. */
const MAX_MATCHES = 40;

/**
 * apron-web's own commands, those it handles itself as `composerAction` does, with what it needs for each: `/nick`
 * with `command`; `/join`, `/leave` and `/topic` with `rooms`, and `/kick` and `/invite` too while the server takes
 * member changes; `/live` with `embed:append`. Each hint follows the extension's suggested convention.
 */
export function ownCommands(caps: { command: boolean; rooms: boolean; members?: boolean; append?: boolean }): CommandEntry[] {
	const own = (name: string, description: string, hint?: string): CommandEntry => ({ name, description, ...(hint ? { hint } : {}), own: true });
	return [
		...(caps.command ? [own('nick', 'Change your display name', '<name>')] : []),
		...(caps.command && caps.rooms ? [
			own('join', 'Join a room, or open one you’re in', '#room'),
			own('leave', 'Leave this room, or the room named', '[#room]'),
			own('topic', 'Set this room’s description', '<text>'),
			...(caps.members !== false ? [
				own('kick', 'Remove a user from this room', '@user'),
				own('invite', 'Add a user to this room', '@user')
			] : [])
		] : []),
		...(caps.append ? [own('live', 'Type your next message live, for everyone to watch')] : [])
	];
}

/**
 * The server's commands (`ext:command_list`) with apron-web's own, each name once (names are case-sensitive): where
 * a name is in both, apron-web's own takes the server's place, as it is what runs; those the server doesn't list follow, in their
 * order. Undefined while the server's are on their way (`failed`: they won't come, and its own are offered alone).
 */
export function mergeCommands(server: readonly ServerCommand[] | undefined, own: readonly CommandEntry[], failed = false): CommandEntry[] | undefined {
	if (!server && !failed) return undefined;
	const mine = new Map(own.map((command) => [command.name, command]));
	const merged: CommandEntry[] = [];
	for (const command of server ?? []) {
		merged.push(mine.get(command.name) ?? command);
		mine.delete(command.name);
	}
	merged.push(...mine.values());
	return merged;
}

/**
 * The suggestions for the command at the caret, and whether Enter takes one (Tab always does), or undefined where no
 * list shows. The first word lists every command it starts, even none (a list that says so). A later word lists only
 * forms of the words before it that it starts: once none do, the words typed are arguments, and nothing shows.
 * A command that requires a reply (`requires` with `reply_to`) is offered only while replying; any other is offered
 * whatever its `requires`, as mentions and files can come after its name. A word named exactly comes first; then,
 * while replying, commands that use `reply_to`, and while files are attached, those that use `body.embeds`; else the
 * server's order, then apron-web's own. Names are case-sensitive: the words before the caret match a name's exactly,
 * and the word at the caret suggests the words it starts in any case, which picking puts in as listed. Enter sends
 * rather than takes when nothing is typed of the word, or the words typed name a command already.
 */
export function commandCompletion(commands: readonly CommandEntry[], found: CommandQuery, context: CommandContext = {}): CommandCompletion | undefined {
	const depth = found.words.length;
	const prefix = found.words;
	const wanted = found.query.toLowerCase();
	const groups = new Map<string, { name: string; bare?: CommandEntry; forms: string[]; fits: boolean; order: number }>();
	for (const command of commands) {
		if (!context.replying && command.requires?.includes('reply_to')) continue;
		const words = command.name.split(' ');
		if (words.length <= depth || !prefix.every((word, index) => words[index] === word)) continue;
		const word = words[depth];
		if (!word.toLowerCase().startsWith(wanted)) continue;
		let group = groups.get(word);
		if (!group) groups.set(word, (group = { name: words.slice(0, depth + 1).join(' '), forms: [], fits: false, order: groups.size }));
		if (words.length === depth + 1) group.bare = command;
		else if (!group.forms.includes(words[depth + 1])) group.forms.push(words[depth + 1]);
		if ((context.replying && command.uses?.includes('reply_to')) || (context.attaching && command.uses?.includes('body.embeds'))) group.fits = true;
	}
	if (depth > 0 && groups.size === 0) return undefined;
	const suggestions = [...groups.entries()]
		.sort(([wordA, a], [wordB, b]) => Number(wordB === found.query) - Number(wordA === found.query) || Number(b.fits) - Number(a.fits) || a.order - b.order)
		.slice(0, MAX_MATCHES)
		.map(([, group]): CommandSuggestion => ({
			name: group.name,
			...(group.bare?.hint ? { hint: group.bare.hint } : {}),
			...(group.bare?.description ? { description: group.bare.description } : {}),
			forms: group.forms
		}));
	const typed = [...prefix, found.query].join(' ');
	const named = commands.some((command) => command.name === typed);
	return { suggestions, enter: suggestions.length > 0 && wanted !== '' && !named };
}
