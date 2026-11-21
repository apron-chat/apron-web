/**
 * The server's commands (`ext:command_list`, which comes with `command`) as the page offers them: the composer's
 * `CommandOffer`, the command reference's open state and sections, and which of apron-web's own commands the server
 * takes over (`serves`). It loads with the app, and is plain code the page calls, not effects: nothing of it runs as
 * the session changes, only as whose list it follows does (`follow`) and as commands are typed. What offers them
 * (`command-tools.ts`: the list and the autocomplete) loads on demand, the first time a server advertises the
 * extension.
 */
import type { ChatClient, ClientSnapshot } from '$lib/protocol/client';
import type { ReferenceSection } from '$lib/design/components/types';
import type { CommandContext, CommandOffer, OfferedCommand } from './command-query';
import { notifyAccount } from './notify-scopes';
import { loadCommandLists, saveCommandLists } from './storage';

type Tools = typeof import('./command-tools');
type Loaded = { tools: Tools; list: InstanceType<Tools['CommandList']> };

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
	/** The composer's commands: set on a server that lists them, else none (the composer offers no commands then). */
	offer = $state.raw<CommandOffer | undefined>();
	/** The command reference is open. */
	shown = $state(false);
	private loaded = $state.raw<Loaded | undefined>();
	/** The tools couldn't be loaded: the reference says so, rather than wait. */
	private failed = $state(false);
	private loading: Promise<Loaded> | undefined;
	/** The command used from the reference, put in the composer once it has closed (it keeps the focus till then). */
	private used: string | undefined;
	/** The commands offered: the server's with apron-web's own (`mergeCommands`); undefined while on their way. */
	private readonly merged: OfferedCommand[] | undefined;
	private readonly own: OfferedCommand[] | undefined;
	private readonly offering: CommandOffer;

	constructor(private readonly host: CommandsHost) {
		this.own = $derived(this.loaded?.tools.ownCommands({ command: true, ...host.caps() }));
		this.merged = $derived(this.loaded && this.own ? this.loaded.tools.mergeCommands(this.loaded.list.commands, this.own, this.loaded.list.failed) : undefined);
		const commands = this;
		this.offering = {
			get ready() {
				return commands.merged !== undefined;
			},
			complete: (found) => (this.loaded && this.merged ? this.loaded.tools.commandCompletion(this.merged, found, host.context()) : undefined),
			describe: (text) => (this.loaded && this.merged ? this.loaded.tools.commandInfo(this.merged, text) : undefined),
			started: () => this.need(),
			browse: () => this.show()
		};
	}

	/**
	 * Follows the list of the server and `user_id` a signed-in snapshot is for (one `user_id` only, as the extension
	 * says), kept on this device for an account, and asks for it on connecting only for an account with none kept and
	 * none asked for in a day (`CommandList.connected`). `key` empty: no extension, no commands.
	 */
	follow(chat: ChatClient, next: ClientSnapshot, key: string): void {
		this.following = key;
		const userId = next.you?.user_id;
		if (!key || userId === undefined) {
			this.offer = undefined;
			this.loaded?.list.apply(undefined);
			return;
		}
		this.offer = this.offering;
		const source = { key: notifyAccount(chat.url, userId), keep: Boolean(next.passkeySession || next.keptSession), list: () => chat.listCommands() };
		this.withTools(({ list }) => {
			// A later snapshot may have followed another list meanwhile.
			if (this.following !== key) return;
			list.apply(source);
			list.connected();
		});
	}

	/** A command was started: a moment to ask for the list (`CommandList.need`). */
	need(): void {
		if (this.following) this.withTools(({ list }) => list.need());
	}

	/** `/help` was sent: what it lists may have changed, so the list is asked for anew (`CommandList.refresh`). */
	refresh(): void {
		if (this.following) this.withTools(({ list }) => list.refresh());
	}

	/** Whether the server lists a command by this name, exactly: one of apron-web's own by it then goes to the server. */
	readonly serves = (name: string): boolean => this.loaded?.list.commands?.some((command) => command.name === name) ?? false;

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

	/** What the reference shows: its sections, or that they're on their way, or why they won't come. */
	get reference(): { sections: ReferenceSection[]; loading: boolean; error?: string } {
		if (this.failed) return { sections: [], loading: false, error: 'The commands couldn’t be loaded: check your connection and try again.' };
		const loaded = this.loaded;
		if (!loaded || !this.own || (!loaded.list.commands && !loaded.list.failed)) return { sections: [], loading: true };
		return { sections: loaded.tools.referenceSections(loaded.list.commands ?? [], this.own), loading: false };
	}

	/** Runs `then` with the tools, once they have loaded: in order, as asked. Their list is kept where `storage.ts` keeps it. */
	private withTools(then: (loaded: Loaded) => void): void {
		this.loading ??= import('./command-tools').then((tools) => {
			this.failed = false;
			return (this.loaded = { tools, list: new tools.CommandList({ read: loadCommandLists, write: saveCommandLists }) });
		});
		this.loading.then(then, () => {
			this.loading = undefined;
			this.failed = true;
		});
	}
}
