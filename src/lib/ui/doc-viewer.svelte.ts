/**
 * The full-screen document viewer: one at a time, opened by a plain click on an uploaded Markdown file's card. It
 * shows the file rendered as a message body is, on a page that scrolls. `DocViewerHost` (loaded on demand, and
 * mounted by the page once it first opens) reads the file and draws it.
 */
import { Viewer } from './viewer.svelte';

export { isMarkdownName } from '$lib/protocol/client-views';

/** The file the viewer shows: where to read it, its name, and who sent it and when. */
export interface DocView {
	readonly url: string;
	readonly title: string;
	readonly detail?: string;
}

export const docViewer = new Viewer<DocView>();
