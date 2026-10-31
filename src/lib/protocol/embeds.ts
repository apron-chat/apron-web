/**
 * HTTP side of embeds (PROTOCOL.md §4.8.3): writing an upload's content to
 * its `write_url`, and deciding which embed URLs are safe to load. Media
 * loads only from the chat server's own origin and the origins it names
 * (`ext:media`, EXT.md §6), live text (`live-text.ts`) only from its own;
 * links may point anywhere `http(s)`.
 */

import { withoutBidiOverrides } from './plain-text';

/** The HTTP origin of a WebSocket server URL (`wss://chat.example/ws` → `https://chat.example`). */
export function serverOrigin(webSocketUrl: string): string | undefined {
	try {
		const url = new URL(webSocketUrl);
		url.protocol = url.protocol === 'wss:' ? 'https:' : url.protocol === 'ws:' ? 'http:' : url.protocol;
		return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : undefined;
	} catch {
		return undefined;
	}
}

/** A link a click may open: only `http:` and `https:`. */
export function safeLink(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
	} catch {
		return undefined;
	}
}

const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * Media (images, video, audio) and live text the client may load: the chat
 * server's origin only (§4.8.1, §4.8.3: clients SHOULD NOT load `og` media or
 * live text URLs from other origins), plus small inline images.
 */
export function sameOriginMedia(value: unknown, origin: string | undefined): string | undefined {
	if (typeof value !== 'string') return undefined;
	if (DATA_IMAGE.test(value) && value.length <= 65_536) return value;
	const link = safeLink(value);
	return link && origin && new URL(link).origin === origin ? link : undefined;
}

/**
 * The exact `https:` origins in a list (or `http:` ones on localhost),
 * such as `ext.media.origins`, dropping anything else: a path, a query, or
 * anything that isn't a string.
 */
export function parseOrigins(value: unknown): string[] {
	return (Array.isArray(value) ? value : []).flatMap((entry) => {
		if (typeof entry !== 'string') return [];
		try {
			const url = new URL(entry);
			const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
			return url.origin === entry && (url.protocol === 'https:' || (url.protocol === 'http:' && local)) ? [url.origin] : [];
		} catch {
			return [];
		}
	});
}

/** In a list of trusted origins: every `http(s):` origin, as the viewer may choose to load media from anywhere. */
export const ANY_ORIGIN = '*';

/**
 * Media the client may load (§4.8.1): what `sameOriginMedia` allows, plus
 * files on the `trusted` origins, such as those the chat server names for its
 * media (`ext:media`) and those the viewer added; with `ANY_ORIGIN` among
 * them, any `http(s):` file.
 */
export function embedMedia(value: unknown, origin: string | undefined, trusted: readonly string[] = []): string | undefined {
	const own = sameOriginMedia(value, origin);
	if (own) return own;
	const link = safeLink(value);
	if (!link) return undefined;
	return trusted.includes(ANY_ORIGIN) || trusted.includes(new URL(link).origin) ? link : undefined;
}

/**
 * An avatar to show (§4.8.7): `https:` URLs, small image data URLs, and
 * files the chat server hosts. Loaded as images only.
 */
export function safeAvatar(value: unknown, origin: string | undefined): string | undefined {
	if (typeof value !== 'string') return undefined;
	const media = sameOriginMedia(value, origin);
	if (media) return media;
	const link = safeLink(value);
	return link?.startsWith('https:') ? link : undefined;
}

/**
 * Writes a file to an embed's `write_url` (§4.8.3). Reports upload
 * progress where the platform can (XMLHttpRequest); resolves when the server
 * accepted the content.
 */
export function writeEmbed(writeUrl: string, file: Blob, onProgress?: (progress: number) => void, signal?: AbortSignal): Promise<void> {
	if (typeof XMLHttpRequest === 'undefined') {
		return fetch(writeUrl, {
			method: 'PUT',
			body: file,
			...(file.type ? { headers: { 'Content-Type': file.type } } : {}),
			...(signal ? { signal } : {})
		}).then((response) => {
			if (!response.ok) throw new WriteError(response.status);
			onProgress?.(1);
		});
	}
	return new Promise((resolve, reject) => {
		const request = new XMLHttpRequest();
		request.open('PUT', writeUrl);
		if (file.type) request.setRequestHeader('Content-Type', file.type);
		request.upload.onprogress = (event) => {
			if (event.lengthComputable && event.total > 0) onProgress?.(Math.min(1, event.loaded / event.total));
		};
		request.onload = () => {
			if (request.status >= 200 && request.status < 300) {
				onProgress?.(1);
				resolve();
			} else {
				reject(new WriteError(request.status));
			}
		};
		request.onerror = () => reject(new Error('The upload did not reach the server'));
		request.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
		signal?.addEventListener('abort', () => request.abort(), { once: true });
		request.send(file);
	});
}

/** A write the server refused, by HTTP status. */
export class WriteError extends Error {
	constructor(readonly status: number) {
		super(writeError(status));
	}
}

/** Only the standard meanings of a status (RFC 9110): what else a server means by one is its own. */
function writeError(status: number): string {
	if (status === 413) return 'The file is larger than this server accepts';
	if (status === 415) return 'The server does not accept this type of file';
	return `The server refused the upload (${status})`;
}

/**
 * What a message's embeds are, in a word, for a preview of a message with no text (a quote, a thread's last
 * message, a notification): live text still being appended, a terminal by its title, else an attachment.
 * Undefined without any.
 */
export function embedsLabel(embeds: unknown): string | undefined {
	const entries = (Array.isArray(embeds) ? embeds : []).filter((entry): entry is Record<string, unknown> => entry !== null && typeof entry === 'object' && typeof entry.kind === 'string');
	if (!entries.length) return undefined;
	if (entries.some((entry) => entry.kind === 'append')) return 'Live text';
	const terminal = entries.find((entry) => entry.kind === 'terminal');
	if (terminal) {
		const title = typeof terminal.title === 'string' ? withoutBidiOverrides(terminal.title).replace(/\s+/g, ' ').trim() : '';
		return title ? `Terminal: ${title}` : 'Terminal';
	}
	return 'Attachment';
}
