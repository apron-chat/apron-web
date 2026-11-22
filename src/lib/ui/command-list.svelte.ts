/**
 * The connected server's commands for this user (extension `ext:command_list`), which the composer offers as a command
 * is typed. Asked for as the extension suggests: when the user first starts a command on this page (a `/` at the
 * draft's start), and again whenever they send `/help`; on connecting, signed in to an account, only while nothing is
 * kept for it, and then at most once a day. A result is kept for the one `user_id` it was listed for, by server and
 * `user_id`: an account's on this device too, so the next visit offers it at once, while the first command started
 * there asks for it anew; a guest's, whose `user_id` lasts one connection, for that connection only.
 */
import { parseCommandList, type ServerCommand } from '$lib/protocol/command-list';
import type { JsonObject } from '$lib/protocol/types';

/** The most accounts whose command lists are kept; the ones asked longest ago go first. */
const COMMAND_LISTS_MAX = 10;

/**
 * What is kept of an account's command list on this device (by `notifyAccount` of the server and its `user_id`): the
 * commands, when it was listed, and when it was last asked for, whether or not that worked.
 */
export type KeptCommandList = { commands?: ServerCommand[]; listed?: number; asked: number };

/**
 * Where every kept list is, as one JSON value (`loadCommandLists` and `saveCommandLists` in `storage.ts`, which the
 * page hands over, as this module loads on demand); a test passes its own.
 */
export interface StoredCommandLists {
	read(): unknown;
	write(lists: Record<string, unknown>): void;
}

/** The kept lists as stored, each an object with a numeric `asked`; what isn't one is left out. */
type StoredList = Record<string, unknown>;

function storedLists(stored: StoredCommandLists): Record<string, StoredList> {
	const lists: Record<string, StoredList> = Object.create(null);
	const value = stored.read();
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return lists;
	for (const [account, entry] of Object.entries(value as Record<string, unknown>)) {
		if (typeof entry === 'object' && entry !== null && typeof (entry as StoredList).asked === 'number') lists[account] = entry as StoredList;
	}
	return lists;
}

/** `account`'s kept list, its commands read as a result's are (`parseCommandList`), so they're held to the same rules. */
export function keptList(stored: StoredCommandLists, account: string): KeptCommandList | undefined {
	const entry = storedLists(stored)[account];
	if (!entry) return undefined;
	const kept: KeptCommandList = { asked: entry.asked as number };
	if (Array.isArray(entry.commands) && typeof entry.listed === 'number') {
		kept.commands = parseCommandList({ commands: entry.commands });
		kept.listed = entry.listed;
	}
	return kept;
}

/**
 * The most characters all kept lists take, stored: a share of the few megabytes a page's storage has, which drafts and
 * settings need too.
 */
const COMMAND_LISTS_CHARS = 150_000;

/**
 * Keeps `account`'s list as `list` holds it, the others as stored. Past COMMAND_LISTS_MAX accounts, or COMMAND_LISTS_CHARS
 * stored, the ones asked longest ago go; if `account`'s alone is still too large, only when it was asked for is kept.
 */
export function keepList(stored: StoredCommandLists, account: string, list: (kept: StoredList | undefined) => StoredList): void {
	const { [account]: previous, ...others } = storedLists(stored);
	const mine = list(previous);
	const own = account.length + JSON.stringify(mine).length > COMMAND_LISTS_CHARS ? { asked: mine.asked } : mine;
	let size = account.length + JSON.stringify(own).length;
	const lists: [string, StoredList][] = [[account, own]];
	for (const [key, entry] of Object.entries(others).sort((a, b) => (b[1].asked as number) - (a[1].asked as number)).slice(0, COMMAND_LISTS_MAX - 1)) {
		size += key.length + JSON.stringify(entry).length;
		if (size > COMMAND_LISTS_CHARS) break;
		lists.push([key, entry]);
	}
	stored.write(Object.fromEntries(lists));
}

/** On connecting, nothing kept is asked for again only after this long, as is a list kept this long once a command starts. */
export const COMMAND_LIST_AGE_MS = 24 * 60 * 60 * 1000;
/** A list that couldn't be had is asked for again, as a command starts, only after this long. */
const RETRY_MS = 60 * 1000;

/**
 * Where the list comes from: whose it is (`notifyAccount` of the server and the `user_id`), whether it is kept on this
 * device (an account's), and the request that lists it (`ChatClient.listCommands`).
 */
export interface CommandSource {
	key: string;
	keep: boolean;
	/** The request's result, which the list parses (`parseCommandList`). */
	list: () => Promise<JsonObject>;
}

export class CommandList {
	/** The account's commands, kept or listed: undefined while none are known. */
	commands = $state.raw<readonly ServerCommand[] | undefined>();
	/** None are known and the last ask failed: the composer offers apron-web's own commands alone. */
	failed = $state(false);
	/** Some are known, and the last ask for them anew failed: they may be out of date. */
	stale = $state(false);
	private source: CommandSource | undefined;
	/** The key being asked for, while its request is out. */
	private asking: string | undefined;
	/** When each key was last asked for on this page, and whether that worked. */
	private readonly asked = new Map<string, { at: number; ok: boolean }>();

	constructor(
		private readonly stored: StoredCommandLists,
		private readonly now: () => number = Date.now
	) {}

	/** Follows the page's server and account: undefined while there is none, or it doesn't advertise the extension. */
	apply(source: CommandSource | undefined): void {
		const previous = this.source;
		this.source = source;
		if (source?.key === previous?.key) {
			// Known to be an account's only now: what is kept for it shows, unless this page has listed it already.
			if (source?.keep && !previous?.keep) this.commands ??= keptList(this.stored, source.key)?.commands;
			return;
		}
		this.commands = source?.keep ? keptList(this.stored, source.key)?.commands : undefined;
		this.failed = false;
		this.stale = false;
	}

	/**
	 * A connection is ready: signed in to an account with nothing kept for it, and no ask in a day (on any page), it
	 * asks now. A guest is asked for as a command starts: its `user_id` is new with each connection, so nothing would
	 * ever be kept for it to hold back the next.
	 */
	connected(): void {
		const source = this.source;
		if (!source?.keep || this.commands) return;
		const asked = storedLists(this.stored)[source.key]?.asked as number | undefined;
		if (asked !== undefined && this.now() - asked < COMMAND_LIST_AGE_MS) return;
		this.ask();
	}

	/**
	 * The user starts a command: it asks, unless the list was listed on this page within a day, or an ask that failed
	 * was just made.
	 */
	need(): void {
		const source = this.source;
		if (!source) return;
		const last = this.asked.get(source.key);
		if (last && this.now() - last.at < (last.ok ? COMMAND_LIST_AGE_MS : RETRY_MS)) return;
		this.ask();
	}

	/** `/help` was sent: what it lists may have changed, so the list is asked for anew. */
	refresh(): void {
		this.ask();
	}

	private ask(): void {
		const source = this.source;
		if (!source || this.asking === source.key) return;
		const { key } = source;
		const at = this.now();
		this.asking = key;
		this.asked.set(key, { at, ok: false });
		// Kept once answered, either way: what was listed, or that it was asked for, so connecting doesn't ask again
		// within the day.
		source.list().then(parseCommandList).then(
			(commands) => {
				this.asked.set(key, { at, ok: true });
				if (source.keep) keepList(this.stored, key, () => ({ commands, listed: at, asked: at }));
				if (this.source?.key !== key) return;
				this.commands = commands;
				this.failed = this.stale = false;
			},
			() => {
				if (source.keep) keepList(this.stored, key, (kept) => ({ ...kept, asked: at }));
				if (this.source?.key !== key) return;
				if (this.commands) this.stale = true;
				else this.failed = true;
			}
		).finally(() => {
			if (this.asking === key) this.asking = undefined;
		});
	}
}
