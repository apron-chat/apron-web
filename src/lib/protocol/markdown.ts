import MarkdownIt from 'markdown-it';
import { emojiKeySegments } from './custom-emoji';
import { withoutBidiOverrides } from './plain-text';
import { canSanitize, NO_MEDIA, sanitizeHtml, type MediaCheck } from './sanitize';

/**
 * A body's `markdown` format is CommonMark (§3.5). This renders CommonMark
 * with the extensions §3.5 allows: GitHub tables and strikethrough, and
 * `breaks: true`, so a typed line break is meant: soft breaks render as hard
 * breaks (`<br>`), not as a space. Raw HTML in a message is shown as text, never
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
 * What a prefixed ID in text names (Appendix A.3): `@id` a known user,
 * rendered with their latest name, and `#id` a known room, rendered as a link
 * showing its title. Unknown IDs render as written. System identities (`~`)
 * appear only as senders, never in text.
 */
/** `untitled`: a thread without a title, whose `title` is "Untitled"; its chip names its `room_id` on hover. */
export type RoomMentionTarget = { kind: 'room'; id: string; title: string; untitled?: true };
/** `shared` marks a user whose display name another known user also shows under, so their ID shows beside it. */
export type MentionTarget = { kind: 'user'; id: string; name: string; me?: boolean; shared?: boolean } | RoomMentionTarget;

/** Looks an `@id` up; only a user answers it. A resolver may also answer rooms, for `#id` without a `RoomMentionResolver`. */
export type MentionResolver = (id: string) => MentionTarget | undefined;
/** Resolves a `#room_id`. */
export type RoomMentionResolver = (id: string) => RoomMentionTarget | undefined;

/**
 * A link drawn as a chip in place of its URL, such as an Apron link to a room,
 * thread, message or user (Appendix A.4): an icon for what it is (none for a
 * user, who reads as a mention), its label, quieter words after it, and its tooltip.
 */
export interface LinkChip {
	kind: 'room' | 'thread' | 'message' | 'user';
	/** On another server: not a mention but a chip of its own, its host first, that says opening it leaves this one. */
	elsewhere?: boolean;
	/** The link under it, in place of the one written: its https form with the server, even for a relative one. */
	href: string;
	label: string;
	detail?: string;
	title: string;
}
/** Says how to draw a link shown as its own URL, or nothing to leave it a URL. */
export type LinkResolver = (href: string) => LinkChip | undefined;

/** A custom emoji as text shows it (`ext:emoji`): its image, its hover and screen reader text, and its aspect ratio. */
export interface CustomEmojiImage {
	src: string;
	alt: string;
	/** Together, the aspect ratio; square without them. */
	width?: number;
	height?: number;
}
/** Says how to draw a key (`:name:`), or nothing to leave it text. */
export type EmojiResolver = (key: string) => CustomEmojiImage | undefined;


/** Someone a composer can mention: a room member or a recent sender. */
export interface MentionPerson {
	id: string;
	name?: string;
	avatar?: string;
	/** The viewer. */
	me?: boolean;
}

/**
 * The ID after an `@` or `#` in text (Appendix A.3): the longest run of
 * `[A-Za-z0-9_.+@:-]` that starts and ends with a letter, a digit, or `_`, so
 * `@ada@example.com.` names `ada@example.com`.
 */
export const TEXT_ID = /[A-Za-z0-9_](?:[A-Za-z0-9_.+@:-]*[A-Za-z0-9_])?/;
const LEADING_ID = new RegExp(`^${TEXT_ID.source}`);

/** The ID that text after an `@` or `#` starts with (Appendix A.3), if any. */
export function textId(text: string): string | undefined {
	return LEADING_ID.exec(text)?.[0];
}

/** `@user_id` or `#room_id`, its prefix not right after a letter or digit (Appendix A.3). */
const MENTION = new RegExp(`(?<![A-Za-z0-9])(?:@(${TEXT_ID.source})|#(${TEXT_ID.source}))`, 'g');

/**
 * A bare `http(s)://` link, or an Apron link in its `apron:?` form (Appendix
 * A.4), in escaped text: it runs to whitespace or an escaped `<`, `>` or `"`,
 * which can't appear in a URL as typed. `apron:` is a scheme only where one
 * could start, so `web+apron:?`, a form Apron doesn't have, links nothing.
 */
const BARE_URL = /(?:\bhttps?:\/\/|(?<![A-Za-z0-9_+.-])apron:\?)(?:(?!&(?:lt|gt|quot);)[^\s<])+/gi;

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
 * body is rendered as plain text instead, which needs no sanitizing. Like
 * every render here, it shows the text without bidi embeddings and overrides
 * (§3.5.2); the text itself stays as written.
 */
export function renderMarkdown(text: string, resolve?: MentionResolver, resolveRoom?: RoomMentionResolver, resolveLink?: LinkResolver, resolveEmoji?: EmojiResolver, media: MediaCheck = NO_MEDIA): string {
	const source = withoutBidiOverrides(text);
	if (!canSanitize) return linkifyText(escapeHtml(source), resolve, resolveRoom, false, resolveLink, resolveEmoji);
	return sanitizeHtml(linkText(markdown(source), resolve, resolveRoom, resolveLink, resolveEmoji), 'message', media);
}

/** A plain body as HTML: escaped, with bare links and mentions linked. Line breaks are kept by CSS (`pre-wrap`). */
export function renderPlain(source: string, resolve?: MentionResolver, resolveRoom?: RoomMentionResolver, resolveLink?: LinkResolver, resolveEmoji?: EmojiResolver, media: MediaCheck = NO_MEDIA): string {
	const html = linkifyText(escapeHtml(withoutBidiOverrides(source)), resolve, resolveRoom, false, resolveLink, resolveEmoji);
	return canSanitize ? sanitizeHtml(html, 'message', media) : html;
}

/**
 * A bio (`ext:bio`) as HTML: escaped, with bare `http(s)` links linked, each
 * opening in a new tab. Mentions and Apron links stay text: a bio isn't a
 * message, and nothing on a profile card opens rooms. Line breaks are kept by
 * CSS (`pre-line`).
 */
export function renderBio(source: string): string {
	const html = linkifyText(escapeHtml(withoutBidiOverrides(source)), undefined, undefined, true);
	return canSanitize ? sanitizeHtml(html, 'message', NO_MEDIA) : html;
}

/**
 * Markdown as plain text, for a one-line or clamped preview such as a thread
 * card's description: rendered, then its tags dropped (block ends become line
 * breaks) and entities decoded. The result is text, never markup.
 */
export function markdownText(source: string): string {
	return unescapeHtml(markdown(withoutBidiOverrides(source))
		.replace(/<br\s*\/?>|<\/(?:p|li|h[1-6]|pre|blockquote|tr)>/gi, '\n')
		.replace(/<[^>]*>/g, ''))
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
 * messages, reply quotes and composer chips): its text is `@name`, with the
 * `user_id` after it in parentheses when another known user shares the name,
 * or a room's title, `#title` when written `#room_id`.
 */
export function mentionLabel({ target, hash }: Mention): string {
	if (target.kind === 'user') return target.shared && target.name !== target.id ? `@${target.name} (${target.id})` : `@${target.name}`;
	return `${hash ? '#' : ''}${target.title}`;
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
		return `<button type="button" class="${className}" data-room-id="${escapeHtml(target.id)}" title="Open ${escapeHtml(target.title)}${target.untitled ? ` (#${escapeHtml(target.id)})` : ''}">${label}</button>`;
	}
	const title = target.name !== target.id ? ` title="@${escapeHtml(target.id)}"` : '';
	return `<button type="button" class="${className}" data-user-id="${escapeHtml(target.id)}"${title}>${label}</button>`;
}

/**
 * Links bare URLs, `@user_id`, and `#room_id` in rendered text, leaving tags,
 * attributes, code and existing links alone (which open in a new tab): an ID inside `<code>` is code,
 * not a mention. A link written as its own URL (`<https://…>`) may become a chip (`resolveLink`).
 */
function linkText(html: string, resolve?: MentionResolver, resolveRoom?: RoomMentionResolver, resolveLink?: LinkResolver, resolveEmoji?: EmojiResolver): string {
	let out = '';
	let index = 0;
	let codeDepth = 0;
	while (index < html.length) {
		const tagStart = html.indexOf('<', index);
		const text = html.slice(index, tagStart === -1 ? undefined : tagStart);
		out += codeDepth > 0 ? text : linkifyText(text, resolve, resolveRoom, false, resolveLink, resolveEmoji);
		if (tagStart === -1) break;
		const tagEnd = html.indexOf('>', tagStart);
		if (tagEnd === -1) {
			out += html.slice(tagStart);
			break;
		}
		const autolink = resolveLink && codeDepth === 0 ? /^<a href="([^"]*)">([^<]*)<\/a>/.exec(html.slice(tagStart)) : null;
		if (autolink && asWritten(autolink[1]) === asWritten(autolink[2])) {
			const chip = linkChip(autolink[1], resolveLink!);
			if (chip) {
				out += chip;
				index = tagStart + autolink[0].length;
				continue;
			}
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
function linkifyText(text: string, resolve?: MentionResolver, resolveRoom?: RoomMentionResolver, webOnly = false, resolveLink?: LinkResolver, resolveEmoji?: EmojiResolver): string {
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
		if (!(webOnly ? /^https?:\/\/[^/?#]/i : /^(?:https?:\/\/[^/?#]|apron:\?.)/i).test(url)) continue;
		out += chipText(emojiText(text.slice(index, match.index)), resolve, resolveRoom, resolveEmoji);
		out += (resolveLink && linkChip(url, resolveLink)) || `<a href="${url}"${LINK_ATTRS}>${url}</a>`;
		index = match.index + url.length;
	}
	return out + chipText(emojiText(text.slice(index)), resolve, resolveRoom, resolveEmoji);
}

/**
 * A link as the chip `resolveLink` draws it, or undefined to leave it a URL. It stays a link, to the
 * chip's `href`, so the page opens it, and copying it or a modified click works as on any link. `href` is escaped.
 */
function linkChip(href: string, resolveLink: LinkResolver): string | undefined {
	const chip = resolveLink(unescapeHtml(href));
	if (!chip) return undefined;
	// A user's reads as a user mention; the rest on this server as a room mention, with their kind's icon in front; another server's as neither.
	const className = chip.elsewhere ? 'ap-linkchip ap-linkchip-elsewhere'
		: chip.kind === 'user' ? 'ap-mention ap-linkchip' : `ap-mention ap-mention-room ap-linkchip ap-linkchip-${chip.kind}`;
	const detail = chip.detail ? `<span class="ap-linkchip-detail">${escapeHtml(chip.detail)}</span>` : '';
	return `<a href="${escapeHtml(chip.href)}"${LINK_ATTRS} class="${className}" title="${escapeHtml(chip.title)}">${escapeHtml(chip.label)}${detail}</a>`;
}

/**
 * A link's `href` or text in rendered markup as it reads: unescaped, and with
 * the percent-encoding Markdown gives an autolink's `href` (not its text)
 * decoded, so `<https://link.apron.chat/#room=général>` is its own URL.
 */
function asWritten(value: string): string {
	const text = unescapeHtml(value);
	try {
		return decodeURI(text);
	} catch {
		return text;
	}
}

/** Escaped text, as rendered markup holds it, back to the text: the entities `escapeHtml` and DOMPurify write. */
export function unescapeHtml(value: string): string {
	return value.replace(/&(lt|gt|quot|#39|amp);/g, (_, entity: string) => ({ lt: '<', gt: '>', quot: '"', '#39': "'", amp: '&' })[entity] ?? '');
}

/**
 * Wraps each emoji in escaped text so it renders in the picker's color emoji
 * faces (`--font-emoji`) rather than whatever glyph the text face carries.
 */
function emojiText(text: string): string {
	return text.replace(EMOJI, (emoji) => `<span class="ap-emoji">${emoji}</span>`);
}

/**
 * Replaces known users and rooms in escaped text, then the keys of custom
 * emoji in the text between them; entities never contain ID or key characters.
 */
function chipText(text: string, resolve?: MentionResolver, resolveRoom?: RoomMentionResolver, resolveEmoji?: EmojiResolver): string {
	return mentionSegments(text, resolve, resolveRoom)
		.map((segment) => (typeof segment === 'string' ? customEmojiText(segment, resolveEmoji) : mentionChip(segment)))
		.join('');
}

/** The keys of custom emoji (`ext:emoji`) in escaped text as their images, scanned left to right (`emojiKeySegments`); unknown keys stay text. */
function customEmojiText(text: string, resolveEmoji?: EmojiResolver): string {
	if (!resolveEmoji || !text.includes(':')) return text;
	const found = new Map<string, CustomEmojiImage | undefined>();
	const image = (key: string) => {
		if (!found.has(key)) found.set(key, resolveEmoji(key));
		return found.get(key);
	};
	return emojiKeySegments(text, (key) => image(key) !== undefined)
		.map((segment) => (typeof segment === 'string' ? segment : customEmojiTag(image(segment.key)!)))
		.join('');
}

/**
 * A custom emoji's image in text: loaded as an image only (§4.8.6), with its
 * hover and screen reader text, scaled to the line by CSS, its aspect ratio
 * from `width` and `height`, else square.
 */
export function customEmojiTag(emoji: CustomEmojiImage): string {
	const ratio = emoji.width && emoji.height ? `${emoji.width} / ${emoji.height}` : '1 / 1';
	const alt = escapeHtml(emoji.alt);
	return `<img class="ap-cemoji" src="${escapeHtml(emoji.src)}" alt="${alt}" title="${alt}" style="aspect-ratio: ${ratio}">`;
}

/**
 * Splits text around its mentions of known users (`@user_id`) and references
 * to known rooms (`#room_id`). Unknown IDs, and an `@` or `#` right after a
 * letter or digit, stay text.
 */
export function mentionSegments(written: string, resolve?: MentionResolver, resolveRoom?: RoomMentionResolver): MentionSegment[] {
	// Shown, so without bidi embeddings and overrides (§3.5.2).
	const text = withoutBidiOverrides(written);
	if (!resolve && !resolveRoom) return [text];
	const segments: MentionSegment[] = [];
	let last = 0;
	for (const match of text.matchAll(MENTION)) {
		const [whole, user, room] = match;
		const offset = match.index;
		const target = user !== undefined ? resolve?.(user) : resolveRoom?.(room) ?? resolve?.(room);
		if (!target || target.kind !== (user !== undefined ? 'user' : 'room')) continue;
		if (offset > last) segments.push(text.slice(last, offset));
		segments.push({ target, hash: room !== undefined });
		last = offset + whole.length;
	}
	if (last < text.length) segments.push(text.slice(last));
	return segments;
}
