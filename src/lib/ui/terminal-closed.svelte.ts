/**
 * Terminal embeds closed in this tab (Close in a terminal embed's header): a
 * closed one shows only its header, and its live text is not read. They stay
 * closed when their message is drawn again, such as on coming back to its
 * room, until Show or a reload.
 */
import { SvelteSet } from 'svelte/reactivity';

const closed = new SvelteSet<string>();

/**
 * What names an embed here: its `embed_id`, on the server at `origin` (each
 * server assigns its own, §4.8.2), else its `url`. Without either, it has
 * none, and the embed's own component keeps whether it is closed.
 */
export function terminalKey(origin: string, embed: { embed_id?: unknown; url?: unknown }): string | undefined {
	if (typeof embed.embed_id === 'string' && embed.embed_id) return `${origin} ${embed.embed_id}`;
	if (typeof embed.url === 'string' && embed.url) return embed.url;
	return undefined;
}

export const closedTerminals = {
	has: (key: string): boolean => closed.has(key),
	close: (key: string): void => void closed.add(key),
	show: (key: string): void => void closed.delete(key),
	/** For tests: none closed. */
	clear: (): void => closed.clear()
};
