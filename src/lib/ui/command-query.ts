import type { ServerCommand } from '$lib/protocol/command-list';
import { isCommand } from '$lib/design/components/compose';

/**
 * The part of the composer's command autocomplete (extension `ext:command_list`) that loads with the app: what a field
 * reads to find a command at the caret, and the types it shares with `command-autocomplete.ts`, which loads with the
 * commands, on demand (`command-tools.ts`).
 */

/** A command the composer offers: the server's, or apron-web's own (`own`), which it handles itself. */
export interface CommandEntry extends ServerCommand {
	own?: boolean;
}

/**
 * The command being typed at the caret: the words typed before the one at the caret, that word as far as the caret,
 * and where the word ends (at the next space or line break), which a pick replaces up to.
 */
export interface CommandQuery {
	words: string[];
	query: string;
	end: number;
}

/**
 * A suggestion: the words that picking it puts after `/`; the hint and description of the command they name exactly,
 * if one does; and the words its forms go on with, if any (`add` and `remove` after `emoji`).
 */
export interface CommandSuggestion {
	name: string;
	hint?: string;
	description?: string;
	forms: string[];
	/** Not a command: the row after them that opens every command (the command palette), labelled so. */
	browse?: string;
}

/** The row at the end of the suggestions that opens the command palette (`CommandOffer.browse`). */
export const BROWSE_COMMANDS: CommandSuggestion = { name: '', forms: [], browse: 'Browse all commands' };

/** What the composer is doing besides the text, which a command's `uses` and `requires` can fit: replying, or with files attached. */
export interface CommandContext {
	replying?: boolean;
	attaching?: boolean;
}

/** What `commandCompletion` gives: the suggestions, and whether Enter takes one (Tab always does). */
export interface CommandCompletion {
	suggestions: CommandSuggestion[];
	enter: boolean;
}

/**
 * What a field that offers commands (the composer's) gives its `DraftField`, as one prop: how to complete the command
 * at the caret, unset while the commands are on their way; `started`, as a `/` starts a command, a moment to ask for
 * them; and `browse`. One object, so a field without commands takes no more props than before.
 */
export interface CommandOffer {
	/**
	 * The suggestions for the command at the caret, and whether Enter takes one, or undefined where no list shows
	 * (`commandCompletion`, with what the composer is doing): unset while the commands are on their way.
	 */
	readonly complete: ((found: CommandQuery) => CommandCompletion | undefined) | undefined;
	started(): void;
	/**
	 * Opens every command (the command palette), its field holding what was typed of the command: given, the
	 * suggestions end with a row for it (`BROWSE_COMMANDS`).
	 */
	browse?(filter: string): void;
}

/** The longest a command's name is read as typed: past that, it is an argument. */
const QUERY_MAX = 100;
/** Words of a command name, one space between them, then the word at the caret (maybe empty). */
const TYPED = /^(?:\S+ )*\S*$/;

/**
 * The command at the caret: in a draft that is a command (`isCommand`), with the caret in its first words, written
 * one space apart. `text` has one character per caret position.
 */
export function commandQuery(text: string, caret: number): CommandQuery | undefined {
	if (caret < 1 || !isCommand(text)) return undefined;
	const before = text.slice(1, caret);
	if (before.length > QUERY_MAX || !TYPED.test(before)) return undefined;
	const words = before.split(' ');
	const query = words.pop() ?? '';
	let end = caret;
	while (end < text.length && !/\s/.test(text[end])) end++;
	return { words, query, end };
}
