/**
 * Reading an uploaded text file for the document viewer (`DocViewerHost`): its bytes, up to `MAX_DOC_BYTES`, as
 * UTF-8. The server serves it from its own origin, so this reads it only where that server lets other origins
 * read its files (CORS), as an audio clip's waveform does; elsewhere the viewer offers the file to download.
 */
import { readCapped } from '$lib/design/components/util';

/** Larger than this isn't rendered: a long README is tens of KB, and rendering runs on the main thread. */
export const MAX_DOC_BYTES = 1024 * 1024;

/** The file's text, or why there is none: past `MAX_DOC_BYTES`, or not readable from here (the network, the server, CORS). */
export type DocText = { text: string } | { error: 'large' | 'unreadable' };

/** The text of the file at `url`; never rejects. */
export async function readDoc(url: string, signal?: AbortSignal, fetcher: typeof fetch = (...args) => fetch(...args)): Promise<DocText> {
	try {
		const response = await fetcher(url, { signal });
		if (!response.ok) {
			void response.body?.cancel();
			return { error: 'unreadable' };
		}
		const bytes = await readCapped(response, MAX_DOC_BYTES);
		if (!bytes) return { error: 'large' };
		return { text: new TextDecoder().decode(bytes) };
	} catch {
		return { error: 'unreadable' };
	}
}
