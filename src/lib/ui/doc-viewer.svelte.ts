/**
 * The full-screen document viewer: one at a time, opened by a plain click on an uploaded Markdown or plain text file's
 * card. It shows a Markdown file rendered as a message body is, and a plain text file as written, on a page that
 * scrolls. `DocViewerHost` (loaded on demand, and mounted by the page once it first opens) reads the file and draws it.
 */
import { isMarkdownName, isPlainTextName } from '$lib/protocol/client-views';
import { Viewer } from './viewer.svelte';

export { isMarkdownName, isPlainTextName };

/** How the viewer draws a file: rendered as Markdown, or as plain text, as written. */
export type DocKind = 'markdown' | 'text';

/** How the viewer would draw a file named `name`, as its name says; undefined where it doesn't show such a file. */
export function docKindOf(name: string | undefined): DocKind | undefined {
	return isMarkdownName(name) ? 'markdown' : isPlainTextName(name) ? 'text' : undefined;
}

/** The file the viewer shows: where to read it, its name, how to draw it, and who sent it and when. */
export interface DocView {
	readonly url: string;
	readonly title: string;
	readonly kind: DocKind;
	readonly detail?: string;
}

export const docViewer = new Viewer<DocView>();
