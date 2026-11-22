import type { ServerCommand } from '$lib/protocol/command-list';
import type { PickerCommand } from '$lib/design/components/types';
import { isCommand } from '$lib/design/components/compose';

/**
 * The part of the composer's command autocomplete (extension `ext:command_list`) that loads with the app: what a field
 * reads to find a command at the caret, and the types it shares with `command-autocomplete.ts`, which loads with the
 * commands, on demand (`command-tools.ts`).
 */

/** A command the composer offers: the server's, or apron-web's own (`own`), which it handles itself. */
export interface OfferedCommand extends ServerCommand {
	own?: boolean;
}

/**
 * The command being typed at the caret: what's typed of it after the `/` (`typed`), as the words before the one at
 * the caret and that word as far as the caret, and where that word ends (at the next space or line break), which a
 * pick replaces up to.
 */
export interface CommandQuery {
	typed: string;
	words: string[];
	query: string;
	end: number;
}

/** A suggestion, or a command's entry alone (`CommandOffer.describe`), as the MentionPicker shows it. */
export type CommandSuggestion = PickerCommand;

/** The row at the end of the suggestions that opens the command reference (`CommandOffer.browse`). */
export const BROWSE_COMMANDS: CommandSuggestion = { name: '', browse: true };

/**
 * What the composer is doing besides the text, which a command's `uses` and `requires` can fit: replying, with files
 * attached, and in a room it names (`room`: false where there is none to name, a server without rooms).
 */
export interface CommandContext {
	replying?: boolean;
	attaching?: boolean;
	room?: boolean;
}

/** What `commandCompletion` gives: the suggestions, and whether Enter takes one (Tab always does). */
export interface CommandCompletion {
	suggestions: CommandSuggestion[];
	enter: boolean;
}

/**
 * What a field that offers commands (the composer's, on a server that lists them) gives its `DraftField`, as one prop:
 * whether the commands are here (else the list waits for them), how to complete the command at the caret, the command
 * a draft names while its arguments are typed, `started` as a `/` starts a command (a moment to ask for them), and
 * `browse`, which opens every command (the suggestions end with a row for it, `BROWSE_COMMANDS`).
 */
export interface CommandOffer {
	readonly ready: boolean;
	/** The suggestions for the command at the caret (`commandCompletion`), or undefined where no list shows. */
	complete(found: CommandQuery): CommandCompletion | undefined;
	/** The entry of the command a draft names while its arguments are typed (`commandInfo`), if it names one. */
	describe(text: string): CommandSuggestion | undefined;
	started(): void;
	browse(): void;
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
	const typed = text.slice(1, caret);
	if (typed.length > QUERY_MAX || !TYPED.test(typed)) return undefined;
	const words = typed.split(' ');
	const query = words.pop() ?? '';
	let end = caret;
	while (end < text.length && !/\s/.test(text[end])) end++;
	return { typed, words, query, end };
}
