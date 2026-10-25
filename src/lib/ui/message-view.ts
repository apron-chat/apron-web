import type { Notice, UploadState } from '$lib/protocol/client';
import { markdownText, mentionLabel, mentionSegments, renderMarkdown, renderPlain } from '$lib/protocol/markdown';
import { systemScope, type Identity, type MessageBody, type MessageRecord } from '$lib/protocol/types';
import type { EmbedProps, MessageCaps, MessageEmbed, MessageMention, MessageQuote, MessageReply, QuotedPlace, RoomQuote, MessageSender, MessageView, ReactionChip as Chip } from '$lib/design/components/types';
import type { ReactionChip } from './reactions';
import { placeLinksIn, writeApronLink, type ApronLink } from './apron-link';
import { directory, samePieces } from './directory.svelte';
import { embedsOf, hueOf, isSystem, quoteSnippet, replySnippet, textOf } from './messages';
import { eventTime, idMillis, idWhen } from './time';

export type { MessageCaps, MessageView };

/** A room or thread a link names, as the page knows it: joined, listed, or looked up for the link. */
export interface LinkedRoom {
	id: string;
	/** Its parent, for a thread. */
	parentRoomId?: string;
	/** Its description (§3.4), CommonMark by convention. */
	description?: string;
	members?: number;
	private?: boolean;
}

/** Where a message sits in the open pane, and what the viewer may do to it: the page knows these, the record doesn't. */
export interface MessageRow {
	/** A follower in its sender's group. */
	grouped: boolean;
	/** Its reaction chips (`reactionChips`). */
	reactions: ReactionChip[];
	/** `body.mentions` lists the viewer (`mentionsMe`). */
	mention: boolean;
	pinged: boolean;
	highlighted: boolean;
	/** Select mode is on for the pane. */
	selecting: boolean;
	selected: boolean;
	editing: boolean;
	caps: MessageCaps;
}

/** What every row reads from: one object for the page, its fields read only where a row needs them. */
export interface MessageContext {
	/** The quoted message of a reply, in any room (`reply_to` may cross rooms). */
	resolve(messageId: string): MessageRecord | undefined;
	/**
	 * The message a link in a message names (Appendix A.4), where it is on the
	 * server the page is on and has loaded: read only for a message with such links.
	 */
	linked(link: ApronLink): MessageRecord | undefined;
	/** The room or thread a link names, likewise: read only for a message with such links. */
	linkedRoom(link: ApronLink): LinkedRoom | undefined;
	/** The WebSocket URL of that server: what a link without `server` refers to. */
	readonly server: string | undefined;
	/** Files this client is writing to upload embeds, by `embed_id`: read only for a message with embeds. */
	readonly uploads: Record<string, UploadState>;
}

/** A body's markup, rendered from its text with the directory's mentions (§3.5: an absent format is plain). */
function bodyOf(body: MessageBody | undefined): NonNullable<MessageView['body']> {
	const text = typeof body?.text === 'string' ? body.text : '';
	const markdown = body?.format === 'markdown';
	const html = markdown ? renderMarkdown(text, directory.resolve, directory.resolveRoom, directory.resolveLink) : renderPlain(text, directory.resolve, directory.resolveRoom, directory.resolveLink);
	return { html, markdown, code: html.includes('<pre') };
}

/** A scoped notice's title: its sender as the server names it (§3.3), `Name (~id)`. */
function noticeTitle(from: Identity): string {
	return from.name && from.name !== from.user_id ? `${from.name} (${from.user_id})` : from.user_id;
}

/** What a record's row shows that depends only on the record and the directory: kept per record, rendered again only when either changes. */
interface Drawn {
	pieces: readonly unknown[];
	sender: MessageSender;
	noticeTitle: string;
	text: string;
	body?: MessageView['body'];
	/** The links to messages, rooms and threads in its text (`placeLinksIn`). */
	links: ApronLink[];
	time: string;
	timestamp?: number;
}

/** At most this many messages quoted under one message. */
export const QUOTES_MAX = 3;

const drawn = new WeakMap<MessageRecord, Drawn>();
/** The last view made for each record, handed out again while nothing in it changed. */
const made = new WeakMap<MessageRecord, MessageView>();

function draw(event: MessageRecord): Drawn {
	// Read every time, so a caller that tracks what it reads (a $derived) follows renames and new rooms.
	const pieces = directory.pieces;
	const kept = drawn.get(event);
	if (kept && samePieces(kept.pieces, pieces)) return kept;
	const person = directory.person(event.from);
	const userId = person?.user_id ?? event.from.user_id;
	const roles = Array.isArray(person?.roles) ? [...new Set(person.roles.filter((role) => typeof role === 'string' && role.trim()))] : [];
	const avatar = directory.avatar(event.from);
	const sender: MessageSender = { user_id: userId, name: directory.name(event.from) };
	// Name (@user_id) (§3.3): only where it tells people apart, when another user shows under the same name.
	if (userId && directory.sharesName(event.from)) sender.handle = userId;
	if (roles.length) sender.roles = roles;
	if (avatar) sender.avatar = avatar;
	const hue = hueOf(person?.user_id);
	if (hue !== undefined) sender.hue = hue;
	const next: Drawn = {
		pieces,
		sender,
		noticeTitle: noticeTitle(event.from),
		text: textOf(event),
		body: event.deleted ? undefined : bodyOf(event.body),
		links: event.deleted ? [] : placeLinksIn(textOf(event), event.body?.format === 'markdown', QUOTES_MAX + 1),
		time: eventTime(event),
		timestamp: idMillis(event.message_id)
	};
	drawn.set(event, next);
	return next;
}

/** A reply's snippet with its mentions of known users and rooms picked out, as Mentions that only read. */
function snippetOf(text: string): (string | MessageMention)[] {
	return mentionSegments(text, directory.resolve, directory.resolveRoom).map((segment) => {
		if (typeof segment === 'string') return segment;
		const { target, hash } = segment;
		if (target.kind === 'room') return { roomId: target.id, name: target.untitled ? undefined : target.title, thread: target.untitled, hash };
		return { user_id: target.id, name: mentionLabel(segment).slice(1), me: target.me };
	});
}

/** The quote of the message `reply_to` names, or one that says it's unavailable. */
function replyOf(event: MessageRecord, context: MessageContext): MessageReply | undefined {
	const id = event.reply_to?.message_id;
	if (!id || event.deleted) return undefined;
	const target = context.resolve(id);
	if (!target) return {};
	const reply: MessageReply = { id: target.message_id, name: directory.name(target.from), avatar: directory.avatar(target.from), hue: hueOf(directory.person(target.from)?.user_id) };
	if (target.deleted) reply.deleted = true;
	else reply.snippet = snippetOf(replySnippet(target));
	return reply;
}

/** A room or thread as a quote names it, by what the directory calls it; `thread` where that's known otherwise. */
function placeOf(roomId: string, thread = false): QuotedPlace {
	const known = directory.resolveRoom(roomId);
	const place: QuotedPlace = { id: roomId };
	if (known && !known.untitled) place.title = known.title;
	if (thread || known?.untitled) place.thread = true;
	return place;
}

/** The message a link names, as a quote that follows the link. */
function messageQuote(target: MessageRecord, href: string): MessageQuote {
	const quote: MessageQuote = {
		kind: 'message',
		href,
		name: directory.name(target.from),
		avatar: directory.avatar(target.from),
		hue: hueOf(directory.person(target.from)?.user_id),
		room: placeOf(target.room_id),
		timestamp: idMillis(target.message_id),
		time: idWhen(target.message_id)
	};
	if (target.deleted) quote.deleted = true;
	else quote.snippet = snippetOf(quoteSnippet(target));
	return quote;
}

/** The room or thread a link names, as a card that follows the link. */
function roomQuote(room: LinkedRoom, href: string): RoomQuote {
	const quote: RoomQuote = { kind: 'room', href, room: placeOf(room.id, room.parentRoomId !== undefined) };
	if (room.parentRoomId !== undefined) quote.parent = placeOf(room.parentRoomId);
	const description = room.description ? markdownText(room.description) : '';
	if (description) quote.description = description;
	if (room.members !== undefined) quote.members = room.members;
	if (room.private) quote.private = true;
	return quote;
}

/**
 * The messages, rooms and threads its links point to that the page knows,
 * each as a card that follows the link; a link to the message itself, or to
 * a user, shows none.
 */
function quotesOf(event: MessageRecord, seen: Drawn, context: MessageContext): (MessageQuote | RoomQuote)[] | undefined {
	const quotes: (MessageQuote | RoomQuote)[] = [];
	for (const link of seen.links) {
		const server = link.server ?? context.server;
		if (quotes.length >= QUOTES_MAX || !server || !link.room || link.message === event.message_id) continue;
		// The https form with its server, so a link without one opens the same place in a new tab too.
		const href = writeApronLink({ server, room: link.room, message: link.message });
		if (link.message !== undefined) {
			const target = context.linked(link);
			if (target) quotes.push(messageQuote(target, href));
		} else {
			const room = context.linkedRoom(link);
			if (room) quotes.push(roomQuote(room, href));
		}
	}
	return quotes.length ? quotes : undefined;
}

/**
 * Its embeds with what each upload is doing. Your own can be removed, but not
 * the last thing in a message (§3.5: a message has text or embeds; delete it
 * instead), nor an upload still being written.
 */
function embedsIn(event: MessageRecord, row: MessageRow, context: MessageContext, seen: Drawn, name: string): MessageEmbed[] | undefined {
	const embeds = embedsOf(event);
	if (!embeds.length) return undefined;
	const uploads = context.uploads;
	const removable = row.caps.edit && !row.selecting && (Boolean(seen.text.trim()) || embeds.length > 1);
	const detail = seen.time ? `${name} · ${seen.time}` : name;
	return embeds.map((embed, index) => {
		const upload = embed.embed_id ? uploads[embed.embed_id] : undefined;
		const item: MessageEmbed = { key: embed.embed_id ?? String(index), embed: embed as unknown as EmbedProps, detail };
		if (upload) item.upload = upload;
		if (removable && !(upload && !upload.failed)) item.removable = true;
		return item;
	});
}

/**
 * A message's row as plain data (MessageView), from its record, where it sits
 * and what the viewer may do: everything the row shows is decided here, once
 * per change. The sender, body and time are kept per record until it or the
 * directory changes, and while nothing in the result changed the previous
 * view is handed back, so a row whose message didn't change doesn't redraw.
 */
export function messageView(event: MessageRecord, row: MessageRow, context: MessageContext): MessageView {
	const seen = draw(event);
	// A system message shows as a line, or as a card titled by its sender when scoped (Appendix A.1); in select mode as any other.
	const system = isSystem(event) && !row.selecting;
	const scope = systemScope(event.from.user_id);
	const notice = system && scope !== undefined;
	const sender = notice ? { user_id: event.from.user_id, name: seen.noticeTitle } : seen.sender;
	const view: MessageView = { id: event.message_id, sender, timestamp: seen.timestamp, time: seen.time, caps: row.caps };
	// A system line shows its text whatever it is; a message only text it has.
	if (seen.body && (system || seen.text)) view.body = seen.body;
	const reply = replyOf(event, context);
	if (reply) view.reply = reply;
	if (!event.deleted && !system) {
		const quotes = quotesOf(event, seen, context);
		if (quotes) view.quotes = quotes;
	}
	if (!event.deleted) {
		const embeds = embedsIn(event, row, context, seen, seen.sender.name);
		if (embeds) view.embeds = embeds;
		if (row.reactions.length) view.reactions = row.reactions;
	}
	if (row.grouped) view.grouped = true;
	if (event.deleted) view.deleted = true;
	if (system) view.system = true;
	if (scope) view.scope = scope;
	if (row.mention) view.mention = true;
	if (row.pinged) view.pinged = true;
	if (row.highlighted) view.highlighted = true;
	if (row.selecting) view.selecting = true;
	if (row.selected) view.selected = true;
	if (row.editing) view.editing = true;
	const last = made.get(event);
	if (last && sameView(last, view)) return last;
	made.set(event, view);
	return view;
}

/** A transient notice (§3.5, Appendix A.1) as a scoped notice's row: a card titled by its sender, dashed when only you got it. */
export function noticeView(notice: Notice): MessageView {
	return {
		sender: { user_id: notice.from.user_id, name: noticeTitle(notice.from) },
		timestamp: idMillis(String(notice.at)),
		body: bodyOf(notice.body),
		system: true,
		scope: systemScope(notice.from.user_id) ?? 'private'
	};
}

const KEYS = ['id', 'timestamp', 'time', 'grouped', 'deleted', 'system', 'scope', 'mention', 'pinged', 'highlighted', 'selecting', 'selected', 'editing'] as const;

function sameFields<T extends object>(a: T | undefined, b: T | undefined): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	const keys = Object.keys(a) as (keyof T)[];
	return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

function sameList<T>(a: readonly T[] | undefined, b: readonly T[] | undefined, same: (x: T, y: T) => boolean): boolean {
	if (a === b) return true;
	if (!a || !b || a.length !== b.length) return false;
	return a.every((item, index) => same(item, b[index]));
}

const sameChip = (a: Chip, b: Chip) => a.emoji === b.emoji && a.count === b.count && a.mine === b.mine && a.title === b.title && a.label === b.label;
const samePart = (a: string | MessageMention, b: string | MessageMention) => (typeof a === 'string' || typeof b === 'string' ? a === b : sameFields(a, b));

const sameSender = (a: MessageSender, b: MessageSender) =>
	a.user_id === b.user_id && a.name === b.name && a.handle === b.handle && a.avatar === b.avatar && a.hue === b.hue && sameList(a.roles, b.roles, Object.is);
const sameReply = (a: MessageReply, b: MessageReply) =>
	a.id === b.id && a.name === b.name && a.avatar === b.avatar && a.hue === b.hue && a.deleted === b.deleted && sameList(a.snippet, b.snippet, samePart);
const sameMessageQuote = (a: MessageQuote, b: MessageQuote) =>
	a.href === b.href && a.name === b.name && a.avatar === b.avatar && a.hue === b.hue && sameFields(a.room, b.room) && a.timestamp === b.timestamp && a.time === b.time
	&& a.deleted === b.deleted && sameList(a.snippet, b.snippet, samePart);
const sameRoomQuote = (a: RoomQuote, b: RoomQuote) =>
	a.href === b.href && a.description === b.description && a.members === b.members && a.private === b.private && sameFields(a.room, b.room) && sameFields(a.parent, b.parent);
const sameQuote = (a: MessageQuote | RoomQuote, b: MessageQuote | RoomQuote) =>
	a.kind === 'room' ? b.kind === 'room' && sameRoomQuote(a, b) : b.kind === 'message' && sameMessageQuote(a, b);
const sameEmbed = (a: MessageEmbed, b: MessageEmbed) => a.key === b.key && a.embed === b.embed && a.detail === b.detail && a.removable === b.removable && sameFields(a.upload, b.upload);

/** Whether two views of one record draw the same row. */
export function sameView(a: MessageView, b: MessageView): boolean {
	return KEYS.every((key) => a[key] === b[key])
		&& a.body === b.body
		&& (a.sender === b.sender || sameSender(a.sender, b.sender))
		&& sameFields(a.caps, b.caps)
		&& sameList(a.reactions, b.reactions, sameChip)
		&& sameList(a.quotes, b.quotes, sameQuote)
		&& sameList(a.embeds, b.embeds, sameEmbed)
		&& (a.reply === b.reply || (a.reply !== undefined && b.reply !== undefined && sameReply(a.reply, b.reply)));
}
