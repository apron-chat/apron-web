import { embedMedia, safeLink } from '$lib/protocol/embeds';
import type { Embed } from '$lib/protocol/types';

/** How an embed shows as a tile in the message editor (the design system's `AttachmentTile`). */
export interface EmbedTile {
	kind: 'image' | 'audio' | 'file' | 'link';
	name: string;
	detail?: string;
	src?: string;
	/** Its name is the sender's to change: an upload's `title` (§4.8.4). */
	renamable: boolean;
}

/**
 * A message's embed as an editor tile: an upload as its picture, its audio,
 * or a file card under its title; anything else (a link preview, a stream, a
 * frame) as a card named by its title or address. Media load only from where
 * the timeline would load them (`embedMedia`).
 */
export function embedTile(embed: Embed, origin: string | undefined): EmbedTile {
	const og = embed.og ?? {};
	const url = safeLink(embed.url);
	if (embed.kind !== 'upload') {
		const host = url ? new URL(url).host : undefined;
		return { kind: 'link', name: og.title || embed.title || host || embed.kind, detail: host ?? kindName(embed.kind), renamable: false };
	}
	const name = embed.title || og.title || 'File';
	if (!url) return { kind: 'file', name, detail: 'Uploading…', renamable: true };
	const image = embedMedia(og.image?.url, origin);
	const audio = embedMedia(og.audio?.url, origin);
	if (og.video) return image ? { kind: 'image', name, detail: 'Video', src: image, renamable: true } : { kind: 'file', name, detail: 'Video', renamable: true };
	if (audio) return { kind: 'audio', name, src: audio, renamable: true };
	if (image) {
		const size = og.image?.width && og.image.height ? `${og.image.width} × ${og.image.height}` : 'Image';
		return { kind: 'image', name, detail: size, src: image, renamable: true };
	}
	return { kind: 'file', name, detail: fileKind(name), renamable: true };
}

/** What a file is, from its name: "PDF file" for `notes.pdf`, else just "File" (an upload carries no size or type). */
function fileKind(name: string): string {
	const extension = /\.([a-z0-9]{1,5})$/i.exec(name)?.[1];
	return extension ? `${extension.toUpperCase()} file` : 'File';
}

function kindName(kind: string): string {
	return kind === 'stream' ? 'Live text' : kind === 'iframe' ? 'Embedded page' : kind === 'html' ? 'Embedded content' : 'Link';
}
