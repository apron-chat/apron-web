/**
 * Terminal embeds closed on this device (Close in a terminal embed's header):
 * a closed one shows only its header, and its live text is not read. They
 * stay closed when their message is drawn again, on coming back to its room
 * or after a reload, until Show (here or in another tab). The ones closed
 * longest ago show again first, past the most kept. Each account's go with
 * its local history (`HistoryKeeper.forget`): signing out without keeping it,
 * or Clear.
 */
import { notifyAccount } from './notify-scopes';
import { CLOSED_TERMINALS_KEY, forgetClosedTerminals, loadClosedTerminals, saveTerminalClosed } from './storage';

/**
 * What names an embed here: the account it is seen by (`notifyAccount`, the
 * server's WebSocket URL and the signed-in user, or its guests), then its `embed_id` (each server
 * assigns its own, §4.8.2), else its `url`. Without a server, or either, it
 * has none, and the embed's own component keeps whether it is closed, for as
 * long as it is drawn.
 */
export function terminalKey(server: string | undefined, userId: string | undefined, embed: { embed_id?: unknown; url?: unknown }): string | undefined {
	const id = typeof embed.embed_id === 'string' && embed.embed_id ? embed.embed_id : typeof embed.url === 'string' && embed.url ? embed.url : undefined;
	return server && id ? `${notifyAccount(server, userId)} ${id}` : undefined;
}

class ClosedTerminals {
	/** Read from storage when first asked, not as the app starts: most visits show no terminal. */
	#keys: Set<string> | undefined;
	/** Moves on each change, for what reads `has` to follow. */
	#version = $state(0);

	has(key: string): boolean {
		void this.#version;
		return this.#loaded().has(key);
	}

	close(key: string): void {
		this.#replace(saveTerminalClosed([...this.#loaded()], key, true));
	}

	show(key: string): void {
		this.#replace(saveTerminalClosed([...this.#loaded()], key, false));
	}

	/** Shows again what `userId` closed on `server`, what every account closed there, or, with neither, all. */
	forget(server?: string, userId?: string): void {
		// `notifyAccount(server, '')` is the server's part of every account's, through the newline that ends it.
		const prefix = server === undefined ? '' : userId === undefined ? notifyAccount(server, '') : `${notifyAccount(server, userId)} `;
		this.#replace(forgetClosedTerminals([...this.#loaded()], prefix));
	}

	/** Another tab changed `key` in storage: what it closed or showed holds here too. */
	storageChanged(key: string | null): void {
		if (key === CLOSED_TERMINALS_KEY || key === null) this.load();
	}

	/** Reads what is saved again, when next asked, such as in tests. */
	load(): void {
		this.#keys = undefined;
		this.#version++;
	}

	#loaded(): Set<string> {
		return (this.#keys ??= new Set(loadClosedTerminals()));
	}

	#replace(keys: readonly string[]): void {
		this.#keys = new Set(keys);
		this.#version++;
	}
}

export const closedTerminals = new ClosedTerminals();
