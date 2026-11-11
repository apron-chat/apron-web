/**
 * The full-screen document viewer: one at a time, opened by a plain click on an uploaded Markdown file's card. It
 * shows the file rendered as a message body is, on a page that scrolls. `DocViewerHost` (loaded on demand, and
 * mounted by the page once it first opens) reads the file and draws it.
 */
import { Viewer } from './viewer.svelte';

/** The file the viewer shows: where to read it, its name, and who sent it and when. */
export interface DocView {
	readonly url: string;
	readonly title: string;
	readonly detail?: string;
}

/** The names a Markdown file goes by. */
const MARKDOWN = /\.(?:md|markdown|mdown|mkd)$/i;

/** Whether a file named `name` is Markdown, as its name says: an upload carries no type (§4.8.4). */
export function isMarkdownName(name: string | undefined): boolean {
	return Boolean(name && MARKDOWN.test(name.trim()));
}

export const docViewer = new Viewer<DocView>();
