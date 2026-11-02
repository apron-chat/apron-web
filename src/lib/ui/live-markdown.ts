/**
 * Markdown that is still arriving (an `append` embed's text, §4.8.5), made
 * to render calmly until the rest comes: what is cut off mid-construct is
 * closed or held back, so a half-written fence, code span, `**` or link
 * neither turns the text after it into something else nor flickers through
 * raw syntax. Only the shown text changes; the text itself, and what the
 * finished message renders, stay as written.
 *
 * Deliberately small: it closes an open code fence, then, in the last
 * paragraph only, an open code span and an odd `**` or `~~`, and holds back a
 * link or image whose destination hasn't closed, a `[` not yet closed, and a
 * last line that is only a list marker or the start of a setext underline.
 */

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** The text, with what is cut off at its end closed or held back, to render while more is coming. */
export function settleMarkdown(text: string): string {
	const lines = text.split('\n');
	/** The open fence, if any: its character and length. */
	let fence: { char: string; length: number } | undefined;
	/** Where the last paragraph starts: after the last blank line or fence outside code. */
	let paragraph = 0;
	lines.forEach((line, index) => {
		const match = FENCE.exec(line);
		if (fence) {
			if (match && match[1][0] === fence.char && match[1].length >= fence.length && !match[2].trim()) {
				fence = undefined;
				paragraph = index + 1;
			}
			return;
		}
		// A backtick fence's info string has no backtick (CommonMark 4.5); a line like ```` ``` ` ```` is inline code.
		if (match && !(match[1][0] === '`' && match[2].includes('`'))) {
			fence = { char: match[1][0], length: match[1].length };
			return;
		}
		if (!line.trim()) paragraph = index + 1;
	});
	if (fence) return `${text}${text.endsWith('\n') ? '' : '\n'}${fence.char.repeat(fence.length)}`;
	if (paragraph >= lines.length) return text;
	const head = lines.slice(0, paragraph);
	const tail = settleParagraph(lines.slice(paragraph).join('\n'));
	return [...head, tail].join('\n');
}

/** The last paragraph, settled: see `settleMarkdown`. */
function settleParagraph(text: string): string {
	let tail = holdBackLastLine(text);
	// A code span left open: closed with a run of its own length, and nothing else in it is touched; held back while empty.
	const span = openCodeSpan(tail);
	if (span) return tail.slice(span.at + span.run.length).trim() ? `${tail.trimEnd()}${span.run}` : tail.slice(0, span.at);
	tail = holdBackLink(tail);
	const open: { mark: string; at: number }[] = [];
	for (const mark of ['~~', '**']) {
		const at = unmatched(withoutCodeSpans(tail), mark);
		if (at === undefined) continue;
		// A delimiter with nothing after it yet is held back; one with text after it is closed after that text.
		if (!tail.slice(at + mark.length).trim()) tail = tail.slice(0, at) + tail.slice(at + mark.length);
		else open.push({ mark, at });
	}
	// The last opened closes first.
	const closers = open.sort((a, b) => b.at - a.at).map(({ mark }) => mark).join('');
	return closers ? `${tail.trimEnd()}${closers}` : tail;
}

/** A last line that is only a list marker, or `-`/`=` that would make the line above a heading for a moment: held back. */
function holdBackLastLine(text: string): string {
	const cut = text.lastIndexOf('\n');
	const last = text.slice(cut + 1);
	if (!/^ {0,3}(?:[-*+]|\d{1,9}[.)]|[-=]+)\s*$/.test(last) || !last.trim()) return text;
	return cut === -1 ? '' : text.slice(0, cut);
}

/** A link or image at the end still being written: `[label](partial` as its label, `![alt](partial` as nothing, and `[label` as `label`. */
function holdBackLink(text: string): string {
	const destination = /(!?)\[([^\]\n]*)\]\([^)\n]*$/.exec(text);
	if (destination) return text.slice(0, destination.index) + (destination[1] ? '' : destination[2]);
	const label = /(!?)\[([^\]\n]*)$/.exec(text);
	if (label) return text.slice(0, label.index) + (label[1] ? '' : label[2]);
	return text;
}

/** The last code span left open, as the run of backticks that opened it. */
function openCodeSpan(text: string): { at: number; run: string } | undefined {
	let open: { at: number; run: string } | undefined;
	for (const match of text.matchAll(/(?<!\\)`+/g)) {
		if (!open) open = { at: match.index, run: match[0] };
		else if (match[0] === open.run) open = undefined;
	}
	return open;
}

/** The text with its closed code spans blanked out, keeping every offset, so their content counts as no delimiter. */
function withoutCodeSpans(text: string): string {
	return text.replace(/(?<!\\)(`+)([\s\S]*?[^`])\1(?!`)/g, (span) => ' '.repeat(span.length));
}

/** Where the last of an odd number of `mark`s is, outside escapes; undefined when they pair up. */
function unmatched(text: string, mark: string): number | undefined {
	const escaped = mark.replace(/[*~]/g, (char) => `\\${char}`);
	const found = [...text.matchAll(new RegExp(`(?<!\\\\)${escaped}`, 'g'))].map((match) => match.index);
	return found.length % 2 ? found.at(-1) : undefined;
}
