/**
 * The full-screen document viewer: one at a time, opened by a plain click on an uploaded Markdown file's card. It
 * shows the file rendered as a message body is, on a page that scrolls. `DocViewerHost` (loaded on demand, and
 * mounted by the page once it first opens) reads the file and draws it.
 */

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

class DocViewer {
	open = $state(false);
	view = $state.raw<DocView>();
	#opener: HTMLElement | undefined;

	/** Opens on `view`; `opener` (the file's card) gets focus back once it closes. */
	show(view: DocView, opener?: HTMLElement): void {
		this.view = view;
		this.#opener = opener;
		this.open = true;
	}

	/** It closed: focus goes back to the card that opened it, where it still is. */
	closed(): void {
		this.open = false;
		this.view = undefined;
		const opener = this.#opener;
		this.#opener = undefined;
		if (opener?.isConnected) opener.focus({ preventScroll: false });
	}
}

export const docViewer = new DocViewer();
