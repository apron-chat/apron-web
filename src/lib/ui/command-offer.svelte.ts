/**
 * The server's commands (`ext:command_list`, which comes with `command`) as the page offers them: what of it loads with
 * the app. It follows whose list it is (`follow`, as the page finds it changed on a snapshot), and loads the rest
 * (`LoadedCommands`, in `command-tools.ts`) the first time a server advertises the extension: the list, the composer's
 * `CommandOffer`, which names the server takes over (`serves`), and what the command reference shows. Plain code the
 * page calls, not effects: nothing of it runs as the session changes.
 */
import type { ChatClient, ClientSnapshot } from '$lib/protocol/client';
import type { ReferenceSection } from '$lib/design/components/types';
import type { CommandContext, CommandOffer } from './command-query';
import type { CommandSource } from './command-list.svelte';
import { notifyAccount } from './notify-scopes';
import { loadCommandLists, saveCommandLists } from './storage';

type Tools = typeof import('./command-tools');

/** How long snapshots wait before loading the commands' code again, once it failed (`Commands.retry`). */
const RETRY_MS = 30_000;
type Loaded = InstanceType<Tools['LoadedCommands']>;

/** What the page gives: what the composer is doing and can do, and its own parts the commands act on. */
export interface CommandsHost {
	/** Replying, files attached: what fits a command's `uses` and `requires`. */
	context(): CommandContext;
	/** What apron-web's own commands need (`ownCommands`): rooms, member changes, live text. */
	caps(): { rooms: boolean; members: boolean; append: boolean };
	/** Loads the command reference's dialog (its on-demand code). */
	loadReference(): Promise<unknown>;
	/** Puts `/name ` in the composer, focused (`Composer.putCommand`). */
	put(name: string): void;
	focus(): void;
	error(cause: unknown, fallback: string): void;
}

export class Commands {
	/**
	 * Whose list is followed: the server, `user_id` and whether it is kept, as the page builds it on each signed-in
	 * snapshot and compares it, a string (`follow` as it changes). Empty without the extension.
	 */
	following = '';
	/** The composer's commands: set on a server that lists them, once their code has loaded; else none. */
	offer = $state.raw<CommandOffer | undefined>();
	/** The command reference is open. */
	shown = $state(false);
	private loaded = $state.raw<Loaded | undefined>();
	/** The code couldn't be loaded: the reference says so, rather than wait. */
	private failed = $state(false);
	private loading: Promise<Loaded> | undefined;
	/** The command used from the reference, put in the composer once it has closed (it keeps the focus till then). */
	private used: string | undefined;
	/**
	 * The commands' code didn't load while a list was followed: when the page's signed-in snapshots, which follow it
	 * again while this is set, load it again (at most every RETRY_MS), as `need` does at once. 0: none to load. A plain
	 * field, which the page reads on every snapshot.
	 */
	retry = 0;
	/** The list followed, which the loaded code is told of as it loads (`LoadedCommands.follow` takes it once). */
	private source: CommandSource | undefined;

	constructor(
		private readonly host: CommandsHost,
		private readonly load: () => Promise<Tools> = () => import('./command-tools')
	) {}

	/**
	 * Follows the list of the server and `user_id` a signed-in snapshot is for (one `user_id` only, as the extension
	 * says), kept on this device for an account (`directory.account`'s rule). `key` empty: no extension, no commands.
	 */
	follow(chat: ChatClient, next: ClientSnapshot, key: string): void {
		// Followed again for its code (`retry`): not yet, while it keeps failing (offline, or gone after a deploy).
		if (this.retry > Date.now() && key === this.following) return;
		this.following = key;
		this.retry = 0;
		const userId = next.you?.user_id;
		if (!key || userId === undefined) {
			this.source = undefined;
			this.offer = undefined;
			this.loaded?.follow(undefined);
			return;
		}
		this.source = { key: notifyAccount(chat.url, userId), keep: Boolean(next.passkeySession || next.keptSession), list: () => chat.listCommands() };
		this.withLoaded(() => undefined);
	}

	/** A command was started: a moment to ask for the list (`CommandList.need`). */
	need(): void {
		if (this.following) this.withLoaded((loaded) => loaded.list.need());
	}

	/** `/help` was sent: what it lists may have changed, so the list is asked for anew (`CommandList.refresh`). */
	refresh(): void {
		if (this.following) this.withLoaded((loaded) => loaded.list.refresh());
	}

	/**
	 * Whether a draft's command (`text`, after the `/`) is the server's: a name it lists all of whose words lead it
	 * (`LoadedCommands.serves`). apron-web's own by that name then goes to the server.
	 */
	readonly serves = (text: string): boolean => this.loaded?.serves(text) ?? false;

	/** Whether the server's list is known, kept or listed: `/help` opens the reference only then, else goes to the server. */
	get known(): boolean {
		return this.loaded?.known ?? false;
	}

	/** Opens the command reference: `/help`, or the composer's Browse all commands. */
	show(): void {
		this.shown = true;
		this.host.loadReference().catch((cause: unknown) => {
			this.shown = false;
			this.host.error(cause, 'Unable to show the commands');
		});
	}

	/** A command used in the reference: it goes in the composer as the reference closes. */
	use(name: string): void {
		this.used = name;
	}

	/** The reference closed, a command used or not: the composer takes the focus back, with `/name ` for one used. */
	close(): void {
		this.shown = false;
		const used = this.used;
		this.used = undefined;
		if (used !== undefined) this.host.put(used);
		else this.host.focus();
	}

	/** What the reference shows: its sections, or that they're on their way, or why they won't come, or may be out of date. */
	get reference(): { sections: ReferenceSection[]; loading: boolean; error?: string; notice?: string } {
		if (this.failed) return { sections: [], loading: false, error: 'The commands couldn’t be loaded: check your connection and try again.' };
		return this.loaded?.reference ?? { sections: [], loading: true };
	}

	/** Runs `then` with the commands' code, once it has loaded: in order, as asked. */
	private withLoaded(then: (loaded: Loaded) => void): void {
		this.loading ??= this.load().then(({ LoadedCommands }) => {
			this.failed = false;
			return (this.loaded = new LoadedCommands({
				context: () => this.host.context(),
				caps: () => this.host.caps(),
				stored: { read: loadCommandLists, write: saveCommandLists },
				started: () => this.need(),
				browse: () => this.show()
			}));
		});
		this.loading.then(
			(loaded) => {
				// The latest list followed: later snapshots may have followed another meanwhile.
				if (this.source) {
					loaded.follow(this.source);
					this.offer = loaded.offer;
				}
				then(loaded);
			},
			() => {
				this.loading = undefined;
				this.failed = true;
				if (this.following) this.retry = Date.now() + RETRY_MS;
			}
		);
	}

}
