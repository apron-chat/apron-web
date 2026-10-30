import { ANY_ORIGIN, safeLink } from '$lib/protocol/embeds';
import { renderMarkdown } from '$lib/protocol/markdown';
import { compareLogIds, type ReactionSummary } from '$lib/protocol/reducer';
import type { Embed, Identity, MessageRecord } from '$lib/protocol/types';
import { directory } from './directory.svelte';
import { mediaGate, type MediaGate } from './media-gate';
import { embedsOf, messageSnippet, senderName, textOf } from './messages';
import { dayKeyOf, idMillis, idTime, isGrouped } from './time';

export interface MessageLogOptions {
	/** The name shown for a message's sender; the directory's by default (`senderName`). */
	nameOf?: (event: MessageRecord) => string;
	/** A message a reply answers when it isn't in the log itself, if this client has it. */
	lookup?: (id: string) => MessageRecord | undefined;
	/** Which year is "this year", so a date leaves it out. */
	now?: Date;
	/** A message's reactions, to list after its sender's name; none without it. */
	reactions?: (event: MessageRecord) => readonly ReactionSummary[] | undefined;
	/** The name shown for someone who reacted; the directory's by default. */
	reactorName?: (user: Identity) => string;
	/** Every message's ID in the conversation, in order, so a gap between two in the log can say how many it leaves out. */
	order?: readonly string[];
}

const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
const dayYearFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });

/** Characters that would turn a name or a quoted snippet into Markdown syntax. */
const INLINE_SYNTAX = /[\\`*_[\]<>~]/g;

const inline = (text: string) => text.replace(INLINE_SYNTAX, '\\$&');

/**
 * Messages as a readable Markdown log, for the clipboard ("Copy log"). Each
 * sender's run is one block quote, opened by their name in bold and the time
 * as a paragraph of its own: the first with the full date (`Thursday, Oct 29,
 * 2026 at 6:51 PM`) as an anchor, and the day again wherever it changes.
 * Consecutive messages from one sender a few minutes apart share a quote, as
 * the timeline groups them. A reply opens with one italic line naming what it
 * answers (`↪ Ada: Deploy is green…`). A message with reactions opens a
 * quote of its own, its header listing them (`(👍 from Bob, Andy; 👎 from
 * Alice)`), so they can't be taken for another message's. Where the log
 * skips messages of `order`, a line between the quotes says how many
 * (`_(3 messages omitted)_`), and the next message heads its own. Bodies are
 * copied as written, Markdown and all, with each uploaded image after as a
 * Markdown image; other attachments and link previews are left out, and a
 * message with nothing else shows reads "(attachment)". `messages` are taken
 * in the order given, each once: where one comes more than once (edited, or
 * an upload finishing), its latest snapshot (by `log_id`) stands where it
 * first came.
 */
export function messageLog(messages: readonly MessageRecord[], options: MessageLogOptions = {}): string {
	const nameOf = options.nameOf ?? senderName;
	const reactorName = options.reactorName ?? ((user: Identity) => directory.name(user));
	const now = options.now ?? new Date();
	const byId = new Map<string, MessageRecord>();
	for (const event of messages) {
		const kept = byId.get(event.message_id);
		if (!kept || compareLogIds(event.log_id, kept.log_id) >= 0) byId.set(event.message_id, event);
	}
	const position = new Map(options.order?.map((id, index) => [id, index]));
	// Each run's paragraphs (its header, then each message's reply line and body), or a note of messages left out.
	const runs: (string[] | string)[] = [];
	let previous: MessageRecord | undefined;
	let previousReacted = false;
	let lastDay: string | undefined;
	for (const event of byId.values()) {
		const day = dayKeyOf(event.message_id);
		const newDay = Boolean(day) && day !== lastDay;
		const reacted = event.deleted ? '' : reactionsOf(options.reactions?.(event), reactorName);
		const omitted = previous ? (position.get(event.message_id) ?? 0) - (position.get(previous.message_id) ?? Infinity) - 1 : 0;
		if (omitted > 0) runs.push(`_(${omitted === 1 ? '1 message' : `${omitted} messages`} omitted)_`);
		// A message after a reacted one heads its own quote too, so the reactions read as that one's alone.
		if (!runs.length || !isGrouped(previous, event) || newDay || reacted || previousReacted || omitted > 0) {
			// The first date carries its year whenever it is; later ones only when it isn't `now`'s.
			const date = newDay ? dayOf(event.message_id, lastDay === undefined ? undefined : now) : '';
			const when = [date, idTime(event.message_id)].filter(Boolean).join(' at ');
			runs.push([`**${inline(nameOf(event))}**${when ? ` · ${when}` : ''}${reacted ? ` (${reacted})` : ''}`]);
		}
		if (day) lastDay = day;
		const run = runs[runs.length - 1] as string[];
		if (event.reply_to && !event.deleted) run.push(replyLine(event.reply_to.message_id, byId, options.lookup, nameOf));
		run.push(bodyOf(event));
		previous = event;
		previousReacted = Boolean(reacted);
	}
	return runs.map((run) => (typeof run === 'string' ? run : quoted(run.join('\n\n')))).join('\n\n');
}

/** Reactions as a header lists them, `👍 from Bob, Andy; 👎 from Alice`, or empty for none. */
function reactionsOf(summaries: readonly ReactionSummary[] | undefined, nameOf: (user: Identity) => string): string {
	return (summaries ?? []).filter((summary) => summary.count > 0).map((summary) => {
		const names = summary.users.map((user) => inline(nameOf(user)));
		// Reactors this client has no identity for are counted, not named.
		const unnamed = summary.count - names.length;
		if (unnamed > 0) names.push(names.length ? `${unnamed} more` : `${unnamed} ${unnamed === 1 ? 'person' : 'people'}`);
		return `${inline(summary.emoji)} from ${names.join(', ')}`;
	}).join('; ');
}

/** Text as a block quote: each line behind `> `, and a bare `>` for a blank one so the quote runs on. */
function quoted(text: string): string {
	return text.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n');
}

/** The day a message ID falls on (`Thursday, Oct 29`, with the year when it isn't `now`'s, or always without `now`), or empty when it carries no time. */
function dayOf(id: string, now: Date | undefined): string {
	const millis = idMillis(id);
	if (!millis) return '';
	return (now && new Date(millis).getFullYear() === now.getFullYear() ? dayFormat : dayYearFormat).format(millis);
}

/**
 * Where a pasted log's images load from: anywhere, since it goes only to the clipboard, never into this page, and
 * whatever it is pasted into loads it, or not, as that app chooses.
 */
const PASTED: MediaGate = mediaGate(undefined, [ANY_ORIGIN]);

/**
 * The log as HTML, for a rich paste: the Markdown rendered as a message is,
 * except that its images show (a paste is the reader's to load), with
 * mentions left as written.
 */
export function messageLogHtml(log: string): string {
	return renderMarkdown(log, undefined, undefined, undefined, undefined, PASTED);
}

/** What a log shows for a message's body: its text as written and its images, or a note when it has neither. */
function bodyOf(event: MessageRecord): string {
	if (event.deleted) return '_(deleted)_';
	const text = textOf(event).replace(/\r\n?/g, '\n').trim();
	const images = embedsOf(event).map(imageOf).filter((image) => image !== undefined);
	if (text || images.length) return [text, ...images].filter(Boolean).join('\n\n');
	return embedsOf(event).length ? '_(attachment)_' : '_(empty)_';
}

/** Characters that would end an image's alt text early. */
const ALT_SYNTAX = /[\\[\]]/g;

/** An uploaded image (§4.8.4) as a Markdown image, alt text from its title; nothing for any other embed, or one still uploading. */
function imageOf(embed: Embed): string | undefined {
	if (embed.kind !== 'upload' || embed.og?.video) return undefined;
	const url = safeLink(embed.og?.image?.url);
	if (!url) return undefined;
	const alt = (embed.title || embed.og?.title || 'image').replace(/\s+/g, ' ').replace(ALT_SYNTAX, '\\$&');
	// A URL's `href` is already escaped but for parentheses, which would end the destination early.
	return `![${alt}](${url.replace(/[()]/g, (paren) => (paren === '(' ? '%28' : '%29'))})`;
}

/** A reply's line: who it answers and the first line of what they wrote, or a note when that message isn't here. */
function replyLine(id: string, byId: Map<string, MessageRecord>, lookup: MessageLogOptions['lookup'], nameOf: (event: MessageRecord) => string): string {
	const target = byId.get(id) ?? lookup?.(id);
	if (!target) return '_↪ (an earlier message)_';
	if (target.deleted) return '_↪ (a deleted message)_';
	return `_↪ **${inline(nameOf(target))}**: ${inline(messageSnippet(target))}_`;
}
