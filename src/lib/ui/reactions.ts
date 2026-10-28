import type { ReactionSummary } from '$lib/protocol/client';
import { isEmojiSequence } from '$lib/protocol/custom-emoji';
import type { CustomEmojiImage } from '$lib/protocol/markdown';
import type { Identity } from '$lib/protocol/types';
import { withoutBidiOverrides } from '$lib/protocol/plain-text';

/** A reactor's display name; callers pass the directory's, which prefers the kept object (§3.3). */
export type NameOf = (user: Identity) => string;

const recordedName: NameOf = (user) => withoutBidiOverrides(user.name || '') || user.user_id;

/** How many names a chip's tooltip lists before summing up the rest. */
const NAMES_MAX = 8;

/** How to show a key (§4.7), such as a custom emoji's (`ext:emoji`): its image, or nothing for a placeholder. */
export type KeyImage = (key: string) => CustomEmojiImage | undefined;

/** One reaction chip under a message: the emoji, how many reacted, and whether you did. */
export interface ReactionChip {
	/** The entry, as toggling sends it: an emoji sequence, or a key. */
	emoji: string;
	/** A key shown as its image. */
	image?: CustomEmojiImage;
	/** A key the client can't show (§4.7): a placeholder, the key its tooltip. */
	placeholder?: boolean;
	count: number;
	mine: boolean;
	/** Who reacted, for the tooltip: "You, Ada and Bob reacted with 👍". */
	title: string;
	/** What a screen reader hears, including what a click does. */
	label: string;
	/** Everyone who reacted, you first, for the list a long press or right-click opens. */
	reactors: Identity[];
}

/** Who reacted with this emoji: you first, then others in the summary's order. */
export function reactorsOf(summary: ReactionSummary, you: string | undefined): Identity[] {
	const own = you === undefined ? undefined : summary.users.find((user) => user.user_id === you);
	const others = summary.users.filter((user) => user.user_id !== you);
	if (own) return [own, ...others];
	return summary.mine && you !== undefined ? [{ user_id: you }, ...others] : others;
}

/**
 * A name among words of the app's own, isolated between U+2068 and U+2069
 * (§3.5.2): one written right to left can't reorder the words around it,
 * where a <bdi> can't go, such as a tooltip.
 */
export const isolated = (name: string) => `\u2068${name}\u2069`;

/** "You, Ada and 3 others": you first, then others in the summary's order, each name isolated (`isolated`). */
export function whoReacted(summary: ReactionSummary, you: string | undefined, nameOf: NameOf = recordedName): string {
	const names: string[] = [];
	if (summary.mine || (you !== undefined && summary.user_ids.includes(you))) names.push('You');
	for (const user of summary.users) {
		if (user.user_id === you) continue;
		names.push(isolated(nameOf(user)));
	}
	if (names.length === 0) return '';
	if (names.length === 1) return names[0];
	if (names.length > NAMES_MAX) {
		const shown = names.slice(0, NAMES_MAX - 1);
		return `${shown.join(', ')} and ${names.length - shown.length} others`;
	}
	return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The chips to show under a message: none for tombstones or messages nobody
 * reacted to. An entry that is an emoji sequence shows as itself; a key as
 * its image where `keyImage` has one, with its `alt` (or the key) in the
 * tooltip, and otherwise as a placeholder with the key there (§4.7).
 */
export function reactionChips(
	summaries: readonly ReactionSummary[] | undefined, you: string | undefined, deleted = false, nameOf: NameOf = recordedName, keyImage?: KeyImage
): ReactionChip[] {
	if (deleted || !summaries) return [];
	return summaries
		.filter((summary) => summary.count > 0)
		.map((summary) => {
			const who = whoReacted(summary, you, nameOf);
			const count = `${summary.count} ${summary.count === 1 ? 'reaction' : 'reactions'}`;
			const key = !isEmojiSequence(summary.emoji);
			const image = key ? keyImage?.(summary.emoji) : undefined;
			const shown = image?.alt ?? summary.emoji;
			return {
				emoji: summary.emoji,
				...(image ? { image } : key ? { placeholder: true } : {}),
				count: summary.count,
				mine: summary.mine,
				title: who ? `${who} reacted with ${shown}` : shown,
				label: `${shown} ${count}${summary.mine ? ', including yours. Remove yours' : '. Add yours'}`,
				reactors: reactorsOf(summary, you)
			};
		});
}
