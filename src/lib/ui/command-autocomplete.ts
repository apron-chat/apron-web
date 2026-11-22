import { COMMAND_GROUPS, type CommandGroup, type ServerCommand } from '$lib/protocol/command-list';
import type { ReferenceCommand, ReferenceSection } from '$lib/design/components/types';
import type { CommandCompletion, CommandContext, CommandQuery, CommandSuggestion, OfferedCommand } from './command-query';

/**
 * The composer's commands (extension `ext:command_list`): the server's and apron-web's own (`ownCommands`), as a `/`
 * at the draft's start offers them (`commandCompletion`), as the card names the one being filled out (`commandInfo`),
 * and as the command reference lists them all (`referenceSections`). Commands whose names start with the same word are
 * forms of one command (`emoji add`, `emoji remove`): the first word is offered once, and its forms once it is typed.
 * Loaded with the commands, on demand (`command-tools.ts`); `command-query.ts` holds what loads with the app, which
 * this imports only types from, so as not to split it into a chunk of its own.
 */

/** The most suggestions listed at once; the list scrolls. */
const MAX_MATCHES = 40;

/**
 * apron-web's own commands, those it handles itself as `composerAction` does, with what it needs for each: `/nick`
 * with `command`; `/join`, `/leave` and `/topic` with `rooms`, and `/kick` and `/invite` too while the server takes
 * member changes; `/live` with `embed:append`. Each hint follows the extension's suggested convention.
 */
export function ownCommands(caps: { command: boolean; rooms: boolean; members?: boolean; append?: boolean }): OfferedCommand[] {
	const own = (name: string, description: string, hint?: string): OfferedCommand => ({ name, description, hint, own: true });
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
 * The server's commands (`ext:command_list`) and then apron-web's own, each name once (names are case-sensitive): a
 * name the server lists is the server's, and apron-web's own of that name is set aside while it does (`composerAction`
 * sends it to the server). Undefined while the server's are on their way (`failed`: they won't come, and its own are
 * offered alone).
 */
export function mergeCommands(server: readonly ServerCommand[] | undefined, own: readonly OfferedCommand[], failed = false): OfferedCommand[] | undefined {
	if (!server && !failed) return undefined;
	const listed = new Set(server?.map((command) => command.name));
	return [...(server ?? []), ...own.filter((command) => !listed.has(command.name))];
}

/** What each field a command `requires` is called in its Required label, in the order they're named. */
const REQUIRED = [['reply_to', 'reply'], ['body.mentions', 'mention'], ['body.embeds', 'attachment']] as const;

/** What a command fails without, as its Required label names it ("reply", "mention", "attachment"), if anything. */
function requiredOf(command: OfferedCommand): string[] | undefined {
	const required = REQUIRED.filter(([field]) => command.requires?.includes(field)).map(([, word]) => word);
	return required.length ? required : undefined;
}

/**
 * A command as an entry: its name (or the words given), hint, description, Required label, whether it acts on the
 * room it's sent in (`room_id`, which apron-web sends, so in no Required label), and the forms given.
 */
function entryOf(command: OfferedCommand, name = command.name, forms?: string[]): CommandSuggestion {
	return { name, hint: command.hint, description: command.description, required: requiredOf(command), inRoom: command.uses?.includes('room_id') || undefined, forms };
}

/** Whether a command can be used here: one that requires a reply only while replying, one that requires a room only in one. */
function fits(command: OfferedCommand, context: CommandContext): boolean {
	return (context.replying || !command.requires?.includes('reply_to')) && (context.room !== false || !command.requires?.includes('room_id'));
}

/**
 * The suggestions for the command at the caret, and whether Enter takes one (Tab always does), or undefined where no
 * list shows. The first word lists every command it starts, even none (a list that says so). After a word and a space,
 * with nothing typed of the next, every command those words start, the command they name and each of its forms, as
 * entries of their own; none where the command has no forms, whose arguments are being typed (`commandInfo`). A later
 * word typed lists the forms it starts: once none do, the words typed are arguments, and nothing shows.
 * A command that requires a reply (`requires` with `reply_to`) is offered only while replying, and one that requires a
 * room only in one (`fits`); any other is offered whatever its `requires`, as mentions and files can come after its
 * name. A word named exactly comes first; then,
 * while replying, commands that use `reply_to`, and while files are attached, those that use `body.embeds`; else the
 * server's order, then apron-web's own. Names are case-sensitive: the words before the caret match a name's exactly,
 * and the word at the caret suggests the words it starts, exactly too (`/Ki` suggests no `kick`). Enter sends
 * rather than takes when nothing is typed of the word, or the words typed name a command already.
 */
export function commandCompletion(commands: readonly OfferedCommand[], found: CommandQuery, context: CommandContext = {}): CommandCompletion | undefined {
	const depth = found.words.length;
	const prefix = found.words;
	const wanted = found.query;
	const offered = commands.filter((command) => fits(command, context));
	const under = (command: OfferedCommand) => {
		const words = command.name.split(' ');
		return words.length >= depth && prefix.every((word, index) => words[index] === word);
	};
	if (depth > 0 && !wanted) {
		// The words typed and a space: the command they name and its forms, each an entry, while it has forms.
		const all = offered.filter(under);
		if (!all.some((command) => command.name.split(' ').length > depth)) return undefined;
		return { suggestions: all.slice(0, MAX_MATCHES).map((command) => entryOf(command)), enter: false };
	}
	const groups = new Map<string, { name: string; bare?: OfferedCommand; forms: string[]; fits: boolean; order: number }>();
	for (const command of offered) {
		const words = command.name.split(' ');
		if (words.length <= depth || !under(command)) continue;
		const word = words[depth];
		if (!word.startsWith(wanted)) continue;
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
		.map(([, group]) => (group.bare ? entryOf(group.bare, group.name, group.forms) : { name: group.name, forms: group.forms }));
	const named = commands.some((command) => command.name === found.typed);
	return { suggestions, enter: suggestions.length > 0 && wanted !== '' && !named };
}

/**
 * The command a draft's first line names, while its arguments are typed: the longest name whose words are all the
 * draft's first words, exactly, as an entry (name, hint, description, Required label). Undefined where the draft
 * names none, or is no command.
 */
export function commandInfo(commands: readonly OfferedCommand[], text: string): CommandSuggestion | undefined {
	if (!text.startsWith('/') || text.startsWith('//')) return undefined;
	const words = text.slice(1).split('\n')[0].split(/\s+/);
	let best: OfferedCommand | undefined;
	for (const command of commands) {
		const names = command.name.split(' ');
		if (names.length > words.length || (best && names.length <= best.name.split(' ').length)) continue;
		if (names.every((word, index) => words[index] === word)) best = command;
	}
	return best && entryOf(best);
}

/** Each group's heading in the command reference, in the order shown. */
const HEADINGS: Record<CommandGroup, string> = { all: 'Everyone', guest: 'Guests', member: 'Members', room: 'Room owners', role: 'Roles', admin: 'Admins' };

/**
 * The command reference's sections (`CommandReference`): the server's commands by `group`, widest first, each in the
 * server's order; those without one it knows after them (Other, or Server where none has one); then apron-web's own
 * (Built into the client), each one the server lists by the same name `replaced`; where there's no room (`context`),
 * one that requires one is `noRoom`. Every command is an entry of its
 * own, a form (`emoji add`) as much as any. Empty sections are left out.
 */
export function referenceSections(server: readonly ServerCommand[], own: readonly OfferedCommand[], context: CommandContext = {}): ReferenceSection[] {
	const listed = new Set(server.map((command) => command.name));
	const entries = (commands: readonly OfferedCommand[]): ReferenceCommand[] => commands.map((command) => ({
		...entryOf(command),
		noRoom: (context.room === false && command.requires?.includes('room_id')) || undefined,
		replaced: (command.own && listed.has(command.name)) || undefined
	}));
	const grouped = server.some((command) => command.group !== undefined);
	return [
		...COMMAND_GROUPS.map((group) => ({ title: HEADINGS[group], commands: entries(server.filter((command) => command.group === group)) })),
		{ title: grouped ? 'Other' : 'Server', commands: entries(server.filter((command) => command.group === undefined)) },
		{ title: 'Built into the client', commands: entries(own) }
	].filter((section) => section.commands.length > 0);
}
