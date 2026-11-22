/**
 * The server's commands (`ext:command_list`) once their code has loaded (`command-tools.ts`, on demand): the list kept
 * for the account (`CommandList`), the composer's `CommandOffer` over it and apron-web's own, which names the server
 * takes over, and what the command reference shows. `command-offer.svelte.ts` is what loads with the app, and hands
 * this what it needs from there, so that nothing that loads with the app is imported here.
 */
import type { ReferenceSection } from '$lib/design/components/types';
import { commandCompletion, commandInfo, mergeCommands, ownCommands, referenceSections } from './command-autocomplete';
import { CommandList, type CommandSource, type StoredCommandLists } from './command-list.svelte';
import type { CommandContext, CommandOffer, OfferedCommand } from './command-query';

/** What `command-offer.svelte.ts` hands over: what the composer is doing and can do, and its own parts. */
export interface LoadedCommandsHost {
	/** Replying, files attached: what fits a command's `uses` and `requires`. */
	context(): CommandContext;
	/** What apron-web's own commands need (`ownCommands`): rooms, member changes, live text. */
	caps(): { rooms: boolean; members: boolean; append: boolean };
	/** Where the lists are kept (`storage.ts`). */
	stored: StoredCommandLists;
	/** A command was started: a moment to ask for the list. */
	started(): void;
	/** Opens the command reference. */
	browse(): void;
}

export class LoadedCommands {
	readonly list: CommandList;
	private readonly own: OfferedCommand[];
	/** The commands offered: the server's with apron-web's own (`mergeCommands`); undefined while on their way. */
	private readonly merged: OfferedCommand[] | undefined;
	readonly offer: CommandOffer;

	constructor(private readonly host: LoadedCommandsHost) {
		this.list = new CommandList(host.stored);
		this.own = $derived(ownCommands({ command: true, ...host.caps() }));
		this.merged = $derived(mergeCommands(this.list.commands, this.own, this.list.failed));
		const loaded = this;
		this.offer = {
			get ready() {
				return loaded.merged !== undefined;
			},
			complete: (found) => (this.merged ? commandCompletion(this.merged, found, host.context()) : undefined),
			describe: (text) => (this.merged ? commandInfo(this.merged, text) : undefined),
			started: () => host.started(),
			browse: () => host.browse()
		};
	}

	/** Follows whose list it is (`CommandList.apply`), asking on connecting where `CommandList.connected` would. */
	follow(source: CommandSource | undefined): void {
		this.list.apply(source);
		if (source) this.list.connected();
	}

	/**
	 * Whether a draft's command (`text`, after the `/`) is the server's: a name it lists all of whose words are the
	 * draft's first words, exactly (names are case-sensitive), such as `topic clear`. apron-web's own then doesn't run.
	 */
	serves(text: string): boolean {
		const words = text.split('\n')[0].split(/\s+/);
		return this.list.commands?.some((command) => command.name.split(' ').every((word, index) => words[index] === word)) ?? false;
	}

	/** Whether the server's list is known: kept, or listed on this page. */
	get known(): boolean {
		return this.list.commands !== undefined;
	}

	/** What the reference shows: its sections, or that they're on their way, and whether they may be out of date. */
	get reference(): { sections: ReferenceSection[]; loading: boolean; stale: boolean } {
		const { commands, failed, stale } = this.list;
		if (!commands && !failed) return { sections: [], loading: true, stale: false };
		return { sections: referenceSections(commands ?? [], this.own, this.host.context()), loading: false, stale };
	}
}
