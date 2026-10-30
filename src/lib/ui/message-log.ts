import { safeLink } from '$lib/protocol/embeds';
import { renderMarkdown } from '$lib/protocol/markdown';
import { compareLogIds } from '$lib/protocol/reducer';
import type { Embed, MessageRecord } from '$lib/protocol/types';
import { embedsOf, messageSnippet, senderName, textOf } from './messages';
import { dayKeyOf, idMillis, idTime, isGrouped } from './time';

export interface MessageLogOptions {
	/** The name shown for a message's sender; the directory's by default (`senderName`). */
	nameOf?: (event: MessageRecord) => string;
	/** A message a reply quotes when it isn't in the log itself, if this client has it. */
	lookup?: (id: string) => MessageRecord | undefined;
	/** Which year is "this year", so a date leaves it out. */
	now?: Date;
}

const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const dayYearFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

/** Characters that would turn a name into Markdown syntax inside its `**…**`. */
const NAME_SYNTAX = /[\\`*_[\]<>]/g;

/**
 * Messages as a readable Markdown log, for the clipboard ("Copy log"): one
 * block per sender's run, headed by their name in bold and the time, with the
 * full date on the first message, as an anchor, and the day wherever it
 * changes after. Consecutive
 * messages from one sender a few minutes apart share a header, as the
 * timeline groups them. A reply opens with a one-line quote of what it
 * answers. Bodies are copied as written, Markdown and all, with each
 * uploaded image after as a Markdown image; other attachments and link
 * previews are left out, and a message with nothing else shows reads
 * "(attachment)". `messages` are taken in the order given, each once: where
 * one comes more than once (edited, or an upload finishing), its latest
 * snapshot (by `log_id`) stands where it first came.
 */
export function messageLog(messages: readonly MessageRecord[], options: MessageLogOptions = {}): string {
	const nameOf = options.nameOf ?? senderName;
	const now = options.now ?? new Date();
	const byId = new Map<string, MessageRecord>();
	for (const event of messages) {
		const kept = byId.get(event.message_id);
		if (!kept || compareLogIds(event.log_id, kept.log_id) >= 0) byId.set(event.message_id, event);
	}
	const blocks: string[] = [];
	let previous: MessageRecord | undefined;
	let lastDay: string | undefined;
	for (const event of byId.values()) {
		const lines: string[] = [];
		const day = dayKeyOf(event.message_id);
		const newDay = Boolean(day) && day !== lastDay;
		if (!isGrouped(previous, event) || newDay) {
			// The first date carries its year whenever it is; later ones only when it isn't `now`'s.
			const when = [newDay ? dayOf(event.message_id, lastDay === undefined ? undefined : now) : '', idTime(event.message_id)].filter(Boolean).join(', ');
			lines.push(`**${nameOf(event).replace(NAME_SYNTAX, '\\$&')}**${when ? ` · ${when}` : ''}`);
		}
		if (day) lastDay = day;
		const quote = event.reply_to && !event.deleted ? replyQuote(event.reply_to.message_id, byId, options.lookup, nameOf) : undefined;
		if (quote) lines.push(quote, '');
		lines.push(bodyOf(event));
		blocks.push(lines.join('\n'));
		previous = event;
	}
	return blocks.join('\n\n');
}

/** The date a message ID falls on (`Thu, Oct 30`, with the year when it isn't `now`'s, or always without `now`), or empty when it carries no time. */
function dayOf(id: string, now: Date | undefined): string {
	const millis = idMillis(id);
	if (!millis) return '';
	return (now && new Date(millis).getFullYear() === now.getFullYear() ? dayFormat : dayYearFormat).format(millis);
}

/**
 * The log as HTML, for a rich paste: the Markdown rendered as a message is,
 * except that its images show (a paste is the reader's to load), with
 * mentions left as written.
 */
export function messageLogHtml(log: string): string {
	return renderMarkdown(log, undefined, undefined, undefined, undefined, (src) => src);
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

/** A reply's quote: who it answers and the first line of what they wrote, or a note when that message isn't here. */
function replyQuote(id: string, byId: Map<string, MessageRecord>, lookup: MessageLogOptions['lookup'], nameOf: (event: MessageRecord) => string): string {
	const target = byId.get(id) ?? lookup?.(id);
	if (!target) return '> _(reply to an earlier message)_';
	if (target.deleted) return '> _(reply to a deleted message)_';
	return `> **${nameOf(target).replace(NAME_SYNTAX, '\\$&')}**: ${messageSnippet(target)}`;
}
