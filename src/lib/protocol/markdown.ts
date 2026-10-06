import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';

/**
 * A body's `markdown` format is CommonMark (§3.5). This renders CommonMark
 * with three extensions beyond it: GitHub tables and strikethrough, and
 * `breaks: true`, so a typed line break is meant: soft breaks render as
 * `<br>`, not as a space. Raw HTML in a message is shown as text, never
 * markup (`html: false`, §3.5), and links with unsafe schemes (`javascript:`,
 * `data:` other than images, ...) are not linked.
 */
const md = new MarkdownIt({ html: false, breaks: true, linkify: false, typographer: false });

// Table alignment as a class, so no `style` attribute has to be let through.
md.core.ruler.push('align_class', (state) => {
	for (const token of state.tokens) {
		if (token.type !== 'th_open' && token.type !== 'td_open') continue;
		const align = String(token.attrGet('style') ?? '').match(/^text-align:(left|center|right)$/)?.[1];
		token.attrs = align ? [['class', `ap-align-${align}`]] : null;
	}
});
// Wide tables scroll inside the message rather than widening it.
md.renderer.rules.table_open = () => '<div class="ap-table"><table>\n';
md.renderer.rules.table_close = () => '</table></div>\n';

/**
 * The only markup a body may hold once rendered: what the CommonMark above
 * produces, plus the links and mention chips added to it. Raw HTML never gets
 * this far; sanitizing last also covers everything done after rendering.
 */
const ALLOWED = {
	ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 's', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'a', 'img', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'button'],
	ALLOWED_ATTR: ['href', 'title', 'src', 'alt', 'start', 'class', 'rel', 'target', 'type', 'data-user-id', 'data-room-id'],
	ALLOW_DATA_ATTR: false
};

function sanitize(html: string): string {
	return DOMPurify.sanitize(html, ALLOWED);
}

/**
 * What a prefixed ID in text names (Appendix A.3): `@id` a known user,
 * rendered with their latest name, and `#id` a known room, rendered as a link
 * showing its title. Unknown IDs render as written. System identities (`~`)
 * appear only as senders, never in text.
 */
export type RoomMentionTarget = { kind: 'room'; id: string; title: string };
export type MentionTarget = { kind: 'user'; id: string; name: string; me?: boolean } | RoomMentionTarget;

/** Looks an `@id` up; only a user answers it. A resolver may also answer rooms, for `#id` without a `RoomMentionResolver`. */
export type MentionResolver = (id: string) => MentionTarget | undefined;
/** Resolves a `#room_id`. */
export type RoomMentionResolver = (id: string) => RoomMentionTarget | undefined;

/** Someone a composer can mention: a room member or a recent sender. */
export interface MentionPerson {
	id: string;
	name?: string;
	avatar?: string;
	/** The viewer. */
	me?: boolean;
}

/** `@user_id` or `#room_id`; trailing `.` and `-` are kept outside the ID. */
const MENTION = /@([A-Za-z0-9_.-]+)|#([A-Za-z0-9_.-]+)/g;

/**
 * A bare `http(s)://` link in escaped text: it runs to whitespace or an escaped
 * `<`, `>` or `"`, which can't appear in a URL as typed.
 */
const BARE_URL = /\bhttps?:\/\/(?:(?!&(?:lt|gt|quot);)[^\s<])+/gi;

/**
 * An emoji as the picker draws it: a flag (two regional indicators), a keycap,
 * or a pictograph shown as emoji by default or by its U+FE0F selector, with
 * skin tones, ZWJ joins and flag tags. A bare text-default pictograph (©, ❤
 * without U+FE0F) stays text.
 */
const EMOJI =
	/\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F)(?:\p{Emoji_Modifier}|\uFE0F|[\u{E0020}-\u{E007F}])*(?:\u200D\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|\uFE0F)*)*/gu;

/** Every link in a message opens in a new tab, without telling the site where it came from. */
const LINK_ATTRS = ' rel="noreferrer noopener" target="_blank"';

/** Sources rendered to HTML (before mentions are linked) kept for reuse, least recently used first. */
const CACHE_SIZE = 2000;
const rendered = new Map<string, string>();

/**
 * Markdown output for a source. A body renders every time its message row
 * is created, and again to find its mentions, so reopening a room would parse
 * it all anew; mentions are linked afterwards, so names stay current.
 */
function markdown(source: string): string {
	let html = rendered.get(source);
	if (html !== undefined) {
		rendered.delete(source);
	} else {
		html = md.render(source);
		if (rendered.size >= CACHE_SIZE) rendered.delete(rendered.keys().next().value!);
	}
	rendered.set(source, html);
	return html;
}

/**
 * Markdown rendering with raw HTML and unsafe URL schemes disabled, keeping
 * typed line breaks. Without a DOM to sanitize with (tests, prerendering) the
 * body is rendered as plain text instead, which needs no sanitizing.
 */
export function renderMarkdown(source: string, resolve?: MentionResolver, resolveRoom?: RoomMentionResolver): string {
	if (!DOMPurify.isSupported) return linkifyText(escapeHtml(source), resolve, resolveRoom);
	return sanitize(linkText(markdown(source), resolve, resolveRoom));
}

/** A plain body as HTML: escaped, with bare links and mentions linked. Line breaks are kept by CSS (`pre-wrap`). */
export function renderPlain(source: string, resolve?: MentionResolver, resolveRoom?: RoomMentionResolver): string {
	const html = linkifyText(escapeHtml(source), resolve, resolveRoom);
	return DOMPurify.isSupported ? sanitize(html) : html;
}

/**
 * Markdown as plain text, for a one-line or clamped preview such as a thread
 * card's summary: rendered, then its tags dropped (block ends become line
 * breaks) and entities decoded. The result is text, never markup.
 */
export function markdownText(source: string): string {
	return markdown(source)
		.replace(/<br\s*\/?>|<\/(?:p|li|h[1-6]|pre|blockquote|tr)>/gi, '\n')
		.replace(/<[^>]*>/g, '')
		.replace(/&(lt|gt|quot|#39|amp);/g, (_, entity: string) => ({ lt: '<', gt: '>', quot: '"', '#39': "'", amp: '&' })[entity] ?? '')
		.replace(/\n{2,}/g, '\n')
		.trim();
}

function escapeHtml(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A mention found in text: what it names, and whether it was written `#room_id`. */
export interface Mention {
	target: MentionTarget;
	hash: boolean;
}

/** Text with its mentions of known users and rooms picked out. */
export type MentionSegment = string | Mention;

/**
 * The design system's Mention component, which every mention renders as (in
 * messages, reply quotes and composer chips): its text is `@name`, or a room's
 * title, `#title` when written `#room_id`.
 */
export function mentionLabel({ target, hash }: Mention): string {
	return target.kind === 'user' ? `@${target.name}` : `${hash ? '#' : ''}${target.title}`;
}

export function mentionClass({ target, hash }: Mention): string {
	if (target.kind === 'user') return target.me ? 'ap-mention ap-mention-me' : 'ap-mention';
	return `ap-mention ap-mention-room${hash ? ' ap-mention-hash-room' : ''}`;
}

/** A user as a button that opens their profile card, with their ID on hover when their name differs; a room as a button that opens it. */
function mentionChip(mention: Mention): string {
	const { target } = mention;
	const label = escapeHtml(mentionLabel(mention));
	const className = mentionClass(mention);
	if (target.kind === 'room') {
		return `<button type="button" class="${className}" data-room-id="${escapeHtml(target.id)}" title="Open ${escapeHtml(target.title)}">${label}</button>`;
	}
	const title = target.name !== target.id ? ` title="@${escapeHtml(target.id)}"` : '';
	return `<button type="button" class="${className}" data-user-id="${escapeHtml(target.id)}"${title}>${label}</button>`;
}

/**
 * Links bare URLs, `@user_id`, and `#room_id` in rendered text, leaving tags,
 * attributes, code and existing links alone (which open in a new tab): an ID inside `<code>` is code,
 * not a mention.
 */
function linkText(html: string, resolve?: MentionResolver, resolveRoom?: RoomMentionResolver): string {
	let out = '';
	let index = 0;
	let codeDepth = 0;
	while (index < html.length) {
		const tagStart = html.indexOf('<', index);
		const text = html.slice(index, tagStart === -1 ? undefined : tagStart);
		out += codeDepth > 0 ? text : linkifyText(text, resolve, resolveRoom);
		if (tagStart === -1) break;
		const tagEnd = html.indexOf('>', tagStart);
		if (tagEnd === -1) {
			out += html.slice(tagStart);
			break;
		}
		let tag = html.slice(tagStart, tagEnd + 1);
		// A link in chat opens in a new tab, leaving the conversation where it was.
		if (/^<a\s/i.test(tag)) tag = `${tag.slice(0, -1)}${LINK_ATTRS}>`;
		if (/^<(code|pre|a)[\s>]/i.test(tag)) codeDepth += 1;
		else if (/^<\/(code|pre|a)\s*>$/i.test(tag) && codeDepth > 0) codeDepth -= 1;
		out += tag;
		index = tagEnd + 1;
	}
	return out;
}

/**
 * Links bare URLs in escaped text, then mentions in the text between them. The
 * match is already escaped, so it serves as both the `href` and the label.
 * Trailing punctuation is left out, as is a closing `)` with no opening one in
 * the link, so "(see https://example.com)." links just the URL.
 */
function linkifyText(text: string, resolve?: MentionResolver, resolveRoom?: RoomMentionResolver): string {
	let out = '';
	let index = 0;
	for (const match of text.matchAll(BARE_URL)) {
		let url = match[0];
		for (;;) {
			const trimmed = url.replace(/(?:[.,:;!?'*_~]|&amp;|&#39;)+$/, '');
			const opens = trimmed.split('(').length, closes = trimmed.split(')').length;
			url = trimmed.endsWith(')') && closes > opens ? trimmed.slice(0, -1) : trimmed;
			if (url === trimmed) break;
		}
		if (!/^https?:\/\/[^/?#]/i.test(url)) continue;
		out += chipText(emojiText(text.slice(index, match.index)), resolve, resolveRoom);
		out += `<a href="${url}"${LINK_ATTRS}>${url}</a>`;
		index = match.index + url.length;
	}
	return out + chipText(emojiText(text.slice(index)), resolve, resolveRoom);
}

/**
 * Wraps each emoji in escaped text so it renders in the picker's color emoji
 * faces (`--font-emoji`) rather than whatever glyph the text face carries.
 */
function emojiText(text: string): string {
	return text.replace(EMOJI, (emoji) => `<span class="ap-emoji">${emoji}</span>`);
}

/** Replaces known users and rooms in escaped text; entities never contain ID characters. */
function chipText(text: string, resolve?: MentionResolver, resolveRoom?: RoomMentionResolver): string {
	return mentionSegments(text, resolve, resolveRoom)
		.map((segment) => (typeof segment === 'string' ? segment : mentionChip(segment)))
		.join('');
}

/**
 * Splits text around its mentions of known users (`@user_id`) and references
 * to known rooms (`#room_id`). Unknown IDs, and an `@` or `#` right after a
 * letter or digit, stay text.
 */
export function mentionSegments(text: string, resolve?: MentionResolver, resolveRoom?: RoomMentionResolver): MentionSegment[] {
	if (!resolve && !resolveRoom) return [text];
	const segments: MentionSegment[] = [];
	let last = 0;
	for (const match of text.matchAll(MENTION)) {
		const [whole, rawUser, rawRoom] = match;
		const offset = match.index;
		const before = text[offset - 1];
		const raw = rawUser ?? rawRoom;
		if (before !== undefined && (rawUser !== undefined ? /[A-Za-z0-9@]/ : /[A-Za-z0-9_]/).test(before)) continue;
		const id = raw.replace(/[.-]+$/, '');
		if (!id) continue;
		const target = rawUser !== undefined ? resolve?.(id) : resolveRoom?.(id) ?? resolve?.(id);
		if (!target || target.kind !== (rawUser !== undefined ? 'user' : 'room')) continue;
		if (offset > last) segments.push(text.slice(last, offset));
		segments.push({ target, hash: rawRoom !== undefined });
		last = offset + whole.length - (raw.length - id.length);
	}
	if (last < text.length) segments.push(text.slice(last));
	return segments;
}
