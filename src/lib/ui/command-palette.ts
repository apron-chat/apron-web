import { COMMAND_GROUPS, type CommandGroup } from '$lib/protocol/command-list';
import type { PaletteRow, PaletteSection } from '$lib/design/components/types';
import type { CommandContext, CommandEntry } from './command-autocomplete';

/**
 * The command palette's sections (`CommandPalette`): the server's commands (`ext:command_list`) by `group`, widest
 * first, each in the server's order; those without one it knows after them; then apron-web's own. Loaded with the
 * palette, on demand.
 */

/** Each group's heading, in the order shown. */
const HEADINGS: Record<CommandGroup, string> = { all: 'Everyone', guest: 'Guests', member: 'Members', room: 'Room owners', role: 'Roles', admin: 'Admins' };
/** The heading of the server's commands without a group: after the groups, or alone where none has one. */
const UNGROUPED = 'Other';
const UNGROUPED_ALONE = 'Server';
/** The heading of apron-web's own commands, last. */
const OWN = 'Built in';

/** Why a command won't work right now, by the first field it requires that the composer can't give yet. */
function unfit(command: CommandEntry, context: CommandContext): string | undefined {
	if (command.requires?.includes('reply_to') && !context.replying) return 'Reply to a message first';
	if (command.requires?.includes('body.embeds') && !context.attaching) return 'Attach a file first';
	return undefined;
}

/** What's typed, as it is matched: without a leading `/`, in any case. */
function wantedOf(query: string): string {
	return query.trim().replace(/^\//, '').toLowerCase();
}

/**
 * A section's rows: each first word once, in order of its first command, its own command (or, without one, a row for
 * the word alone, which puts in `/word ` to complete) then its forms under it. With `wanted`, only commands whose name
 * or description holds it, and the first word of any such form.
 */
function rowsOf(commands: readonly CommandEntry[], wanted: string, context: CommandContext): PaletteRow[] {
	const words = new Map<string, { bare?: CommandEntry; forms: CommandEntry[] }>();
	for (const command of commands) {
		const first = command.name.split(' ')[0];
		let word = words.get(first);
		if (!word) words.set(first, (word = { forms: [] }));
		if (command.name === first) word.bare = command;
		else word.forms.push(command);
	}
	const matches = (command: CommandEntry) => !wanted || command.name.toLowerCase().includes(wanted) || command.description.toLowerCase().includes(wanted);
	const rowOf = (command: CommandEntry, form: boolean): PaletteRow => {
		const why = unfit(command, context);
		return { name: command.name, ...(command.hint ? { hint: command.hint } : {}), ...(command.description ? { description: command.description } : {}), ...(form ? { form } : {}), ...(why ? { unfit: why } : {}) };
	};
	const rows: PaletteRow[] = [];
	for (const [first, word] of words) {
		const forms = word.forms.filter(matches);
		const head = word.bare ? matches(word.bare) : !wanted || first.toLowerCase().includes(wanted);
		if (!head && !forms.length) continue;
		rows.push(word.bare ? rowOf(word.bare, false) : { name: first });
		rows.push(...forms.map((form) => rowOf(form, true)));
	}
	return rows;
}

/**
 * The palette's sections for `commands` (`mergeCommands`: the server's, then apron-web's own), narrowed by `query`,
 * each row greyed where its `requires` doesn't fit `context`. Empty sections are left out.
 */
export function paletteSections(commands: readonly CommandEntry[], query: string, context: CommandContext = {}): PaletteSection[] {
	const wanted = wantedOf(query);
	const server = commands.filter((command) => !command.own);
	const grouped = server.some((command) => command.group !== undefined);
	const sections: PaletteSection[] = [
		...COMMAND_GROUPS.map((group) => ({ title: HEADINGS[group], rows: rowsOf(server.filter((command) => command.group === group), wanted, context) })),
		{ title: grouped ? UNGROUPED : UNGROUPED_ALONE, rows: rowsOf(server.filter((command) => command.group === undefined), wanted, context) },
		{ title: OWN, rows: rowsOf(commands.filter((command) => command.own), wanted, context) }
	];
	return sections.filter((section) => section.rows.length > 0);
}
