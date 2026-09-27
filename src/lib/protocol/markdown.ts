import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';

/**
 * CommonMark with GitHub tables and strikethrough. Raw HTML in a message is
 * shown as text, never markup (`html: false`), and links with unsafe schemes
 * (`javascript:`, `data:` other than images, ...) are not linked. A typed line
 * break is meant: soft breaks render as `<br>`, not as a space.
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
 * The only markup a body may hold once rendered: what the Markdown above
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
 * What an `@id` mention names (Appendix A.3): a known user, rendered with
 * their latest name, or a room, rendered as a link to it. Unknown IDs render
 * as written.
 */
export type MentionTarget =
	| { kind: 'user'; id: string; name: string; me?: boolean }
	| { kind: 'room'; id: string; title: string };

/** Looks an ID up; when it names both a user and a room, answer with the user. */
export type MentionResolver = (id: string) => MentionTarget | undefined;

/** Someone a composer can mention: a room member or a recent sender. */
export interface MentionPerson {
	id: string;
	name?: string;
	avatar?: string;
	/** The viewer. */
	me?: boolean;
}

/**
 * `@` then an optional second `@` (system identities, Appendix A.1) and a run of
 * `[A-Za-z0-9_.-]`, not preceded by a letter or digit. Trailing `.` and `-`
 * are not part of the ID.
 */
const MENTION = /@(@?[A-Za-z0-9_.-]+)/g;

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
export function renderMarkdown(source: string, resolve?: MentionResolver): string {
	if (!DOMPurify.isSupported) return linkifyText(escapeHtml(source), resolve);
	return sanitize(linkText(markdown(source), resolve));
}

/** A plain body as HTML: escaped, with bare links and mentions linked. Line breaks are kept by CSS (`pre-wrap`). */
export function renderPlain(source: string, resolve?: MentionResolver): string {
	const html = linkifyText(escapeHtml(source), resolve);
	return DOMPurify.isSupported ? sanitize(html) : html;
}

function escapeHtml(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The markup of the design system's Mention component. */
function mentionChip(target: MentionTarget): string {
	if (target.kind === 'room') {
		return `<button type="button" class="ap-mention ap-mention-room" data-room-id="${escapeHtml(target.id)}" title="Open ${escapeHtml(target.title)}">${escapeHtml(target.title)}</button>`;
	}
	const title = target.name !== target.id ? ` title="@${escapeHtml(target.id)}"` : '';
	return `<span class="ap-mention${target.me ? ' ap-mention-me' : ''}" data-user-id="${escapeHtml(target.id)}"${title}>@${escapeHtml(target.name)}</span>`;
}

/**
 * Links bare URLs and `@id` in the rendered HTML's text, leaving tags,
 * attributes, code and existing links alone (which open in a new tab): an ID inside `<code>` is code,
 * not a mention.
 */
function linkText(html: string, resolve?: MentionResolver): string {
	let out = '';
	let index = 0;
	let codeDepth = 0;
	while (index < html.length) {
		const tagStart = html.indexOf('<', index);
		const text = html.slice(index, tagStart === -1 ? undefined : tagStart);
		out += codeDepth > 0 ? text : linkifyText(text, resolve);
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
function linkifyText(text: string, resolve?: MentionResolver): string {
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
		out += chipText(emojiText(text.slice(index, match.index)), resolve);
		out += `<a href="${url}"${LINK_ATTRS}>${url}</a>`;
		index = match.index + url.length;
	}
	return out + chipText(emojiText(text.slice(index)), resolve);
}

/**
 * Wraps each emoji in escaped text so it renders in the picker's color emoji
 * faces (`--font-emoji`) rather than whatever glyph the text face carries.
 */
function emojiText(text: string): string {
	return text.replace(EMOJI, (emoji) => `<span class="ap-emoji">${emoji}</span>`);
}

/** Replaces mentions in escaped text. Escaped entities never contain ID characters after an `@`. */
function chipText(text: string, resolve?: MentionResolver): string {
	if (!resolve) return text;
	return text.replace(MENTION, (match, raw: string, offset: number) => {
		const before = text[offset - 1];
		if (before !== undefined && /[A-Za-z0-9]/.test(before)) return match;
		const id = raw.replace(/[.-]+$/, '');
		if (!id || id === '@') return match;
		const target = resolve(id);
		const rest = raw.slice(id.length);
		return target ? mentionChip(target) + rest : match;
	});
}
