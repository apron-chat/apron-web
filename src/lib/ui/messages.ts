import { markdownText, type MentionPerson } from '$lib/protocol/markdown';
import { cleanPlainText } from '$lib/protocol/plain-text';
import { isJsonObject, isSystemId, type Embed, type Identity, type MessageRecord } from '$lib/protocol/types';
import { directory } from './directory.svelte';

/** The sender's display name (§3.3): the kept one, else the one the message was posted under. */
export function senderName(event: MessageRecord): string {
	return directory.name(event.from);
}

/** Senders whose `user_id` starts with `~` are system identities (Appendix A.1), shown as system lines. */
export function isSystem(event: MessageRecord): boolean {
	return isSystemId(event.from?.user_id);
}

export function textOf(event: MessageRecord): string {
	return typeof event.body?.text === 'string' ? event.body.text : '';
}

/**
 * A message's text as plain text, for where it isn't rendered (a quote, a card, a notification): a markdown body
 * (§3.5) without its syntax, so `**0 errors**` reads "0 errors", code keeps what's in it and a link shows its text.
 * Mentions stay as written, for whoever picks them out.
 */
export function plainTextOf(event: MessageRecord): string {
	const text = textOf(event);
	return text && event.body?.format === 'markdown' ? markdownText(text) : text;
}

export function embedsOf(event: MessageRecord): Embed[] {
	return Array.isArray(event.body?.embeds)
		? event.body.embeds.filter(isJsonObject).filter((embed): embed is Embed => typeof embed.kind === 'string')
		: [];
}

/**
 * The hue of an avatar placeholder: FNV-1a over the `user_id`, so each person
 * keeps one color everywhere and on every client. The murmur3 finalizer
 * spreads IDs that differ in one character, such as `guest_1` and `guest_2`.
 */
export function avatarHue(userId: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < userId.length; index += 1) {
		hash ^= userId.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	hash ^= hash >>> 16;
	hash = Math.imul(hash, 0x85ebca6b);
	hash ^= hash >>> 13;
	hash = Math.imul(hash, 0xc2b2ae35);
	hash ^= hash >>> 16;
	return (hash >>> 0) % 360;
}

/** The tint of an avatar placeholder, by `user_id` (`avatarHue`); none without one, which keeps the design system's denim. */
export function hueOf(userId: string | undefined): number | undefined {
	return userId ? avatarHue(userId) : undefined;
}

/**
 * A message's text as a quote shows it: its first `lines` non-empty lines as
 * plain text (`plainTextOf`), cut to about `max` characters; one line of about 120 for a reply's
 * quote or a caption, three of about 280 for a link's card.
 */
export function messageSnippet(target: MessageRecord, lines = 1, max = 120): string {
	const text = cleanPlainText(plainTextOf(target)).split('\n').map((line) => line.trim()).filter(Boolean).slice(0, lines).join('\n');
	const short = text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
	return short || (embedsOf(target).length ? 'Attachment' : 'Empty message');
}

export function isOwn(event: MessageRecord, me: Identity | undefined): boolean {
	return Boolean(me && event.from?.user_id === me.user_id);
}

/**
 * Whether you may move the message to another room, into a thread or back
 * out: your own, or anyone's where the server lets you (`moveAny`, from
 * `ext:permissions`).
 */
export function mayMove(event: MessageRecord, me: Identity | undefined, moveAny = false): boolean {
	return isOwn(event, me) || (moveAny && me !== undefined);
}

/** The `user_id`s a message mentions: `body.mentions` (§3.5), whatever its text shows. */
export function mentionsOf(event: MessageRecord): string[] {
	const mentions = event.body?.mentions;
	return Array.isArray(mentions) ? mentions.filter((id): id is string => typeof id === 'string') : [];
}

/**
 * A message mentions you when `body.mentions` lists your `user_id` (§3.5),
 * never because its text happens to name you. Your own messages never ping you.
 */
export function mentionsMe(event: MessageRecord, me: Identity | undefined): boolean {
	if (!me || isOwn(event, me) || event.deleted) return false;
	return mentionsOf(event).some((id) => id === me.user_id || directory.isMe(id));
}

/**
 * Who a composer can mention: the room's members (§4.2.2), kept current by
 * memberships, those who spoke most recently first; without a member list,
 * the room's recent senders. The viewer is marked `me` and is always present.
 * Names, avatars and roles (for `@&role`) are the latest known.
 */
export function peopleIn(messages: MessageRecord[], me: Identity | undefined, members?: Identity[]): MentionPerson[] {
	const people: MentionPerson[] = [];
	const seen = new Set<string>();
	const listed = members && new Set(members.map((member) => member.user_id));
	const add = (from: Identity): void => {
		if (!from?.user_id || seen.has(from.user_id) || isSystemId(from.user_id)) return;
		if (listed && !listed.has(from.user_id) && from.user_id !== me?.user_id) return;
		seen.add(from.user_id);
		const latest = directory.person(from) ?? from;
		const avatar = directory.avatar(from);
		const roles = Array.isArray(latest.roles) ? latest.roles.filter((role) => typeof role === 'string') : [];
		people.push({
			id: from.user_id,
			...(latest.name ? { name: latest.name } : {}),
			...(avatar ? { avatar } : {}),
			...(roles.length ? { roles } : {}),
			...(from.user_id === me?.user_id ? { me: true } : {})
		});
	};
	for (let index = messages.length - 1; index >= 0; index -= 1) add(messages[index].from);
	for (const member of members ?? []) add(member);
	if (me) add(me);
	return people;
}

/** Every ID between two in `order`, inclusive, whichever way round; an ID missing from the order yields just the pair. */
export function rangeBetween(order: string[], from: string, to: string): string[] {
	const start = order.indexOf(from);
	const end = order.indexOf(to);
	if (start === -1 || end === -1) return [...new Set([from, to])];
	return order.slice(Math.min(start, end), Math.max(start, end) + 1);
}

/** Every ID from the earliest picked to the latest, filling the gaps between them. */
export function spanOf(order: string[], picked: string[]): string[] {
	const indexes = picked.map((id) => order.indexOf(id)).filter((index) => index >= 0);
	if (indexes.length < 2) return picked;
	return order.slice(Math.min(...indexes), Math.max(...indexes) + 1);
}
