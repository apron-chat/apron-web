import { HtmlRenderer, Node, Parser } from 'commonmark';

const parser = new Parser();
// A line break typed in a chat message is meant: soft breaks render as `<br />`, not as a space.
const renderer = new HtmlRenderer({ safe: true, softbreak: '<br />' });

/**
 * GitHub-flavored tables, which CommonMark lacks: after block parsing, a
 * paragraph whose line is followed by a delimiter row (`| --- | :-: |`) becomes
 * a table from that line on, and each cell is parsed as inline Markdown.
 */
const INTERNALS = parser as unknown as { processInlines(block: Node): void; inlineParser: { parse(block: Node): void } };
const processInlines = INTERNALS.processInlines;
INTERNALS.processInlines = function (this: typeof INTERNALS, doc: Node) {
	const paragraphs: Node[] = [];
	const walker = doc.walker();
	for (let event = walker.next(); event; event = walker.next()) {
		if (event.entering && event.node.type === 'paragraph') paragraphs.push(event.node);
	}
	for (const paragraph of paragraphs) {
		for (const cell of splitTable(paragraph)) this.inlineParser.parse(cell);
	}
	processInlines.call(this, doc);
};

type Align = '' | 'left' | 'center' | 'right';
type RawNode = Node & { _string_content: string | null; onEnter: string; onExit: string };

/** `| :--- | ---: |`: each cell a run of dashes, with a colon on the side it aligns to. */
const DELIMITER_ROW = /^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

/** A row's cells: split at unescaped pipes, an outer pipe on either end optional; `\|` is a literal pipe. */
function tableCells(line: string): string[] {
	let text = line.trim();
	if (text.startsWith('|')) text = text.slice(1);
	if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);
	return text.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

/** Our own markup around the children: a block starts on its own line, an inline (a cell) doesn't. */
function tableNode(onEnter: string, onExit: string, type: 'custom_block' | 'custom_inline' = 'custom_block'): RawNode {
	const node = new Node(type) as RawNode;
	node.onEnter = onEnter;
	node.onExit = onExit;
	return node;
}

/**
 * Turns the table in a paragraph, if any, into nodes after it (the lines before
 * the header stay the paragraph) and answers the cells, whose inlines are yet to parse.
 */
function splitTable(paragraph: Node): RawNode[] {
	const content = (paragraph as RawNode)._string_content ?? '';
	const lines = content.replace(/\n$/, '').split('\n');
	const at = lines.findIndex((line, index) => {
		const header = lines[index - 1];
		return header !== undefined && (header.includes('|') || line.includes('|')) && DELIMITER_ROW.test(line) && tableCells(line).length === tableCells(header).length;
	});
	if (at < 1) return [];
	const aligns: Align[] = tableCells(lines[at]).map((cell) => cell.startsWith(':') ? (cell.endsWith(':') ? 'center' : 'left') : cell.endsWith(':') ? 'right' : '');
	const cells: RawNode[] = [];
	const row = (line: string, tag: 'th' | 'td') => {
		const tr = tableNode('<tr>', '</tr>');
		const texts = tableCells(line);
		aligns.forEach((align, index) => {
			const cell = tableNode(`<${tag}${align ? ` align="${align}"` : ''}>`, `</${tag}>`, 'custom_inline');
			cell._string_content = texts[index] ?? '';
			tr.appendChild(cell);
			cells.push(cell);
		});
		return tr;
	};
	// Wide tables scroll inside the message rather than widening it.
	const table = tableNode('<div class="ap-table"><table>', '</table></div>');
	const head = tableNode('<thead>', '</thead>');
	head.appendChild(row(lines[at - 1], 'th'));
	table.appendChild(head);
	if (lines.length > at + 1) {
		const body = tableNode('<tbody>', '</tbody>');
		for (const line of lines.slice(at + 1)) body.appendChild(row(line, 'td'));
		table.appendChild(body);
	}
	paragraph.insertAfter(table);
	if (at === 1) paragraph.unlink();
	else (paragraph as RawNode)._string_content = lines.slice(0, at - 1).join('\n') + '\n';
	return cells;
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

/** Every link in a message opens in a new tab, without telling the site where it came from. */
const LINK_ATTRS = ' rel="noreferrer noopener" target="_blank"';

/** Sources rendered to HTML (before mentions are linked) kept for reuse, least recently used first. */
const CACHE_SIZE = 2000;
const rendered = new Map<string, string>();

/**
 * CommonMark output for a source. A body renders every time its message row
 * is created, and again to find its mentions, so reopening a room would parse
 * it all anew; mentions are linked afterwards, so names stay current.
 */
function commonmark(source: string): string {
	let html = rendered.get(source);
	if (html !== undefined) {
		rendered.delete(source);
	} else {
		html = renderer.render(parser.parse(source));
		if (rendered.size >= CACHE_SIZE) rendered.delete(rendered.keys().next().value!);
	}
	rendered.set(source, html);
	return html;
}

/** CommonMark rendering with raw HTML and unsafe URL schemes disabled, keeping typed line breaks. */
export function renderMarkdown(source: string, resolve?: MentionResolver): string {
	return linkText(commonmark(source), resolve);
}

/** A plain body as HTML: escaped, with bare links and mentions linked. Line breaks are kept by CSS (`pre-wrap`). */
export function renderPlain(source: string, resolve?: MentionResolver): string {
	return linkifyText(escapeHtml(source), resolve);
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
		out += chipText(text.slice(index, match.index), resolve);
		out += `<a href="${url}"${LINK_ATTRS}>${url}</a>`;
		index = match.index + url.length;
	}
	return out + chipText(text.slice(index), resolve);
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
