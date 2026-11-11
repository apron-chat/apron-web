/**
 * Terminal embeds closed on this device (Close in a terminal embed's header):
 * a closed one shows only its header, and its live text is not read. They
 * stay closed when their message is drawn again, on coming back to its room
 * or after a reload, until Show (here or in another tab). The ones closed
 * longest ago show again first, past the most kept.
 */
import { CLOSED_TERMINALS_KEY, loadClosedTerminals, saveTerminalClosed } from './storage';

/**
 * What names an embed here: its `embed_id`, on the server at `origin` (each
 * server assigns its own, §4.8.2), else its `url`. Without either (or the
 * server's origin, for an `embed_id`), it has none, and the embed's own
 * component keeps whether it is closed, for as long as it is drawn.
 */
export function terminalKey(origin: string | undefined, embed: { embed_id?: unknown; url?: unknown }): string | undefined {
	if (typeof embed.embed_id === 'string' && embed.embed_id) return origin ? `${origin} ${embed.embed_id}` : undefined;
	if (typeof embed.url === 'string' && embed.url) return embed.url;
	return undefined;
}

class ClosedTerminals {
	#keys = $state<string[]>(loadClosedTerminals());
	readonly #set = $derived(new Set(this.#keys));

	has(key: string): boolean {
		return this.#set.has(key);
	}

	close(key: string): void {
		this.#keys = saveTerminalClosed(this.#keys, key, true);
	}

	show(key: string): void {
		this.#keys = saveTerminalClosed(this.#keys, key, false);
	}

	/** Another tab changed `key` in storage: what it closed or showed holds here too. */
	storageChanged(key: string | null): void {
		if (key === CLOSED_TERMINALS_KEY || key === null) this.load();
	}

	/** Reads what is saved again, such as in tests. */
	load(): void {
		this.#keys = loadClosedTerminals();
	}
}

export const closedTerminals = new ClosedTerminals();
