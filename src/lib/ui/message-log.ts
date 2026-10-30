import type { MessageRecord } from '$lib/protocol/types';
import { embedsOf, messageSnippet, senderName, textOf } from './messages';
import { idMillis, idTime, isGrouped } from './time';

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
 * date on the first message and wherever the day changes. Consecutive
 * messages from one sender a few minutes apart share a header, as the
 * timeline groups them. A reply opens with a one-line quote of what it
 * answers. Bodies are copied as written, Markdown and all; embeds and link
 * previews are left out, and a message with nothing but those reads
 * "(attachment)". `messages` are taken in the order given.
 */
export function messageLog(messages: readonly MessageRecord[], options: MessageLogOptions = {}): string {
	const nameOf = options.nameOf ?? senderName;
	const now = options.now ?? new Date();
	const byId = new Map(messages.map((event) => [event.message_id, event]));
	const blocks: string[] = [];
	let previous: MessageRecord | undefined;
	let lastDay: string | undefined;
	for (const event of messages) {
		const lines: string[] = [];
		const day = dayOf(event.message_id, now);
		if (!isGrouped(previous, event) || (day && day !== lastDay)) {
			const when = [day && day !== lastDay ? day : '', idTime(event.message_id)].filter(Boolean).join(', ');
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

/** The date a message ID falls on (`Thu, Oct 30`, with the year when it isn't `now`'s), or empty when it carries no time. */
function dayOf(id: string, now: Date): string {
	const millis = idMillis(id);
	if (!millis) return '';
	return (new Date(millis).getFullYear() === now.getFullYear() ? dayFormat : dayYearFormat).format(millis);
}

/** What a log shows for a message's body: its text as written, or a note when it has none to show. */
function bodyOf(event: MessageRecord): string {
	if (event.deleted) return '_(deleted)_';
	const text = textOf(event).replace(/\r\n?/g, '\n').trim();
	if (text) return text;
	return embedsOf(event).length ? '_(attachment)_' : '_(empty)_';
}

/** A reply's quote: who it answers and the first line of what they wrote, or a note when that message isn't here. */
function replyQuote(id: string, byId: Map<string, MessageRecord>, lookup: MessageLogOptions['lookup'], nameOf: (event: MessageRecord) => string): string {
	const target = byId.get(id) ?? lookup?.(id);
	if (!target) return '> _(reply to an earlier message)_';
	if (target.deleted) return '> _(reply to a deleted message)_';
	return `> **${nameOf(target).replace(NAME_SYNTAX, '\\$&')}**: ${messageSnippet(target)}`;
}
