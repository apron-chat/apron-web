/**
 * HTTP side of embeds (PROTOCOL.md §4.6.3, §4.6.5): writing an upload or a
 * stream's content to its `write_url`, reading a live stream, and deciding
 * which embed URLs are safe to load. Media and streams load only from the chat
 * server's own origin; links may point anywhere `http(s)`.
 */

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
 * Media (images, video, audio) and streams the client may load: the chat
 * server's origin only (§4.6.1, §4.6.5: clients SHOULD NOT load `og` media or
 * stream URLs from other origins), plus small inline images.
 */
export function sameOriginMedia(value: unknown, origin: string | undefined): string | undefined {
	if (typeof value !== 'string') return undefined;
	if (DATA_IMAGE.test(value) && value.length <= 65_536) return value;
	const link = safeLink(value);
	return link && origin && new URL(link).origin === origin ? link : undefined;
}

/**
 * Parses a comma- or space-separated list of exact `https:` origins (or
 * `http:` ones on localhost), dropping anything else.
 */
export function parseOrigins(value: string | undefined): string[] {
	return (value ?? '').split(/[\s,]+/).flatMap((entry) => {
		try {
			const url = new URL(entry);
			const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
			return url.origin === entry.replace(/\/$/, '') && (url.protocol === 'https:' || (url.protocol === 'http:' && local)) ? [url.origin] : [];
		} catch {
			return [];
		}
	});
}

/**
 * Hosts the build trusts to serve embed media besides the chat server itself,
 * such as a server's storage bucket (`VITE_TRUSTED_MEDIA_ORIGINS`). Outside
 * Vite (the protocol modules also load under plain Node, as apron-server-go's
 * wire tests do) there is no `import.meta.env`, and no extra hosts.
 */
export const TRUSTED_MEDIA_ORIGINS = parseOrigins(import.meta.env?.VITE_TRUSTED_MEDIA_ORIGINS);

/**
 * `og` media the client may load (§4.6.1): what `sameOriginMedia` allows,
 * plus files on a trusted media origin.
 */
export function embedMedia(value: unknown, origin: string | undefined, trusted: readonly string[] = TRUSTED_MEDIA_ORIGINS): string | undefined {
	const own = sameOriginMedia(value, origin);
	if (own) return own;
	const link = safeLink(value);
	return link && trusted.includes(new URL(link).origin) ? link : undefined;
}

/**
 * An avatar to show (§4.6.6): `https:` URLs, small image data URLs, and
 * files the chat server hosts. Loaded as images only.
 */
export function safeAvatar(value: unknown, origin: string | undefined): string | undefined {
	if (typeof value !== 'string') return undefined;
	const media = sameOriginMedia(value, origin);
	if (media) return media;
	const link = safeLink(value);
	return link?.startsWith('https:') ? link : undefined;
}

export interface WriteProgress {
	/** Fraction written, 0–1, when the size is known. */
	progress: number;
}

/**
 * Writes a file to an embed's `write_url` (§4.6.3). Reports upload
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

function writeError(status: number): string {
	if (status === 413) return 'The file is larger than this server accepts';
	if (status === 415) return 'The server does not accept this type of file';
	if (status === 409) return 'This upload link was already used';
	if (status === 410) return 'The message was removed before the upload finished';
	if (status === 404) return 'The upload expired; attach the file again';
	return `The server refused the upload (${status})`;
}

/**
 * Reads a live stream (§4.6.5): `GET url` returns the kept text, then more
 * as it arrives, and ends with the stream. `onText` receives the whole text
 * read so far on this connection; a reader that reconnects replaces what it
 * showed. Resolves when the stream ends.
 */
export async function readStream(url: string, onText: (text: string) => void, signal?: AbortSignal): Promise<void> {
	const response = await fetch(url, { cache: 'no-store', credentials: 'omit', ...(signal ? { signal } : {}) });
	if (!response.ok || !response.body) throw new Error(`The stream is not available (${response.status})`);
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let text = '';
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		text += decoder.decode(value, { stream: true });
		onText(text);
	}
	text += decoder.decode();
	onText(text);
}
