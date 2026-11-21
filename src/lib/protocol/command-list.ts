/**
 * The commands a server lists for the user (extension `ext:command_list`), so that the composer can offer them while
 * they are typed (§4.1). The request takes no params; its result is `{commands}`, in the server's order.
 */
import type { JsonObject } from './types';

/**
 * An object, as `isJsonObject` reads one: written here, as this module loads on demand (`$lib/ui/command-tools`) and
 * importing what loads with the app would split it into a chunk of its own at startup.
 */
function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The fields of a `command` request besides `body.text` that `uses` and `requires` name. */
export type CommandField = 'room_id' | 'reply_to' | 'body.mentions' | 'body.embeds';
const FIELDS: readonly string[] = ['room_id', 'reply_to', 'body.mentions', 'body.embeds'] satisfies CommandField[];

/** Who may use a command (`group`), from the widest to the narrowest: the order clients show them in. */
export const COMMAND_GROUPS = ['all', 'guest', 'member', 'room', 'role', 'admin'] as const;
export type CommandGroup = (typeof COMMAND_GROUPS)[number];

/** One entry of the result: a command, or one form of it (`emoji add`). */
export interface ServerCommand {
	/** The words after `/`, one space between them, such as `kick` or `emoji add`. */
	name: string;
	/** Plain text: what it does. */
	description: string;
	/** Plain text: the text after the name, such as `@user [<reason>]`. Shown as written, never parsed. */
	hint?: string;
	/** The fields besides `body.text` that change what it does. */
	uses?: CommandField[];
	/** The fields it fails without: each is in `uses` too. */
	requires?: CommandField[];
	/** Who may use it, for showing commands in groups only: absent, or a group this client doesn't know, is none. */
	group?: CommandGroup;
}

/** The most commands kept from one result: a list longer than any `/help` is cut, rather than kept whole. */
const COMMANDS_MAX = 500;
/** The most characters kept of a name, and of a description or hint: what a picker's row can show, with room to spare. */
const NAME_MAX = 100;
const TEXT_MAX = 500;

/** The fields of a list that this client knows, each once; any other is ignored. */
function fieldsOf(value: unknown): CommandField[] {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.filter((field): field is CommandField => typeof field === 'string' && FIELDS.includes(field)))];
}

/**
 * The commands in an `ext:command_list` result, in its order. An entry without a name of words is left out, as is a
 * name listed before (names are case-sensitive), or one that starts with `/` (it would be typed `//`, which posts a message). A
 * field of the wrong type takes its default: an empty description, no hint, no fields. A field this client doesn't
 * know is ignored, and one in `requires` counts in `uses` too; a `group` it doesn't know is none.
 */
export function parseCommandList(result: JsonObject): ServerCommand[] {
	const listed = Array.isArray(result.commands) ? result.commands : [];
	const commands: ServerCommand[] = [];
	const seen = new Set<string>();
	for (const entry of listed) {
		if (commands.length >= COMMANDS_MAX) break;
		if (!isJsonObject(entry) || typeof entry.name !== 'string') continue;
		const name = entry.name.trim().split(/\s+/).join(' ');
		if (!name || name.startsWith('/') || name.length > NAME_MAX || seen.has(name)) continue;
		seen.add(name);
		const command: ServerCommand = { name, description: typeof entry.description === 'string' ? entry.description.slice(0, TEXT_MAX) : '' };
		if (typeof entry.hint === 'string' && entry.hint.trim()) command.hint = entry.hint.slice(0, TEXT_MAX);
		const requires = fieldsOf(entry.requires);
		const uses = [...new Set([...fieldsOf(entry.uses), ...requires])];
		if (uses.length) command.uses = uses;
		if (requires.length) command.requires = requires;
		if ((COMMAND_GROUPS as readonly unknown[]).includes(entry.group)) command.group = entry.group as CommandGroup;
		commands.push(command);
	}
	return commands;
}
