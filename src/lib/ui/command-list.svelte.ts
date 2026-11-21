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
 * What is kept of an account's command list on this device (`COMMAND_LISTS_KEY`, by `notifyAccount` of the server and
 * its `user_id`): the commands, when it was listed, and when it was last asked for, whether or not that worked.
 */
export type KeptCommandList = { commands?: ServerCommand[]; listed?: number; asked: number };

/** Where every kept list is, as one JSON value: `COMMAND_LISTS_KEY` in `storage.ts`, which the page hands over. */
export interface StoredCommandLists {
	read(): unknown;
	write(value: unknown): void;
}

/**
 * The lists kept on this device (`CommandListStore`), in `stored`: read as a result is, so what is kept is held to the
 * same rules as what arrives; past COMMAND_LISTS_MAX accounts, the ones asked longest ago go. `stored` is handed over,
 * not imported, as this module loads on demand (`command-tools.ts`).
 */
export function keptLists(stored: StoredCommandLists): CommandListStore {
	const all = (): Record<string, KeptCommandList> => {
		const lists: Record<string, KeptCommandList> = Object.create(null);
		const parsed = stored.read();
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return lists;
		for (const [account, entry] of Object.entries(parsed as Record<string, unknown>)) {
			if (typeof entry !== 'object' || entry === null || typeof (entry as JsonObject).asked !== 'number') continue;
			const { asked, commands, listed } = entry as JsonObject;
			const kept: KeptCommandList = { asked: asked as number };
			if (Array.isArray(commands) && typeof listed === 'number') {
				kept.commands = parseCommandList({ commands });
				kept.listed = listed;
			}
			lists[account] = kept;
		}
		return lists;
	};
	return {
		load: (account) => all()[account],
		save: (account, list) => {
			const { [account]: _previous, ...others } = all();
			stored.write(Object.fromEntries(Object.entries({ ...others, [account]: list }).sort((a, b) => b[1].asked - a[1].asked).slice(0, COMMAND_LISTS_MAX)));
		}
	};
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

/** Where lists are kept between visits (`storage.ts`); a test passes its own. */
export interface CommandListStore {
	load(key: string): KeptCommandList | undefined;
	save(key: string, list: KeptCommandList): void;
}

export class CommandList {
	/** The account's commands, kept or listed: undefined while none are known. */
	commands = $state.raw<readonly ServerCommand[] | undefined>();
	/** None are known and the last ask failed: the composer offers apron-web's own commands alone. */
	failed = $state(false);
	private source: CommandSource | undefined;
	/** The key being asked for, while its request is out. */
	private asking: string | undefined;
	/** When each key was last asked for on this page, and whether that worked. */
	private readonly asked = new Map<string, { at: number; ok: boolean }>();

	constructor(
		private readonly store: CommandListStore,
		private readonly now: () => number = Date.now
	) {}

	/** Follows the page's server and account: undefined while there is none, or it doesn't advertise the extension. */
	apply(source: CommandSource | undefined): void {
		const previous = this.source;
		this.source = source;
		if (source?.key === previous?.key) {
			// Known to be an account's only now: what is kept for it shows, unless this page has listed it already.
			if (source?.keep && !previous?.keep) this.commands ??= this.store.load(source.key)?.commands;
			return;
		}
		this.commands = source?.keep ? this.store.load(source.key)?.commands : undefined;
		this.failed = false;
	}

	/**
	 * A connection is ready: signed in to an account with nothing kept for it, and no ask in a day (on any page), it
	 * asks now. A guest is asked for as a command starts: its `user_id` is new with each connection, so nothing would
	 * ever be kept for it to hold back the next.
	 */
	connected(): void {
		const source = this.source;
		if (!source?.keep || this.commands) return;
		const kept = this.store.load(source.key);
		if (kept && this.now() - kept.asked < COMMAND_LIST_AGE_MS) return;
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
		// Noted before the answer, so a page that closes meanwhile doesn't ask again on connecting within the day.
		if (source.keep) this.store.save(key, { ...this.store.load(key), asked: at });
		source.list().then(parseCommandList).then(
			(commands) => {
				this.asked.set(key, { at, ok: true });
				if (source.keep) this.store.save(key, { commands, listed: at, asked: at });
				if (this.source?.key !== key) return;
				this.commands = commands;
				this.failed = false;
			},
			() => {
				if (this.source?.key === key && !this.commands) this.failed = true;
			}
		).finally(() => {
			if (this.asking === key) this.asking = undefined;
		});
	}
}
