/**
 * Holds media loading to its one gate (`$lib/ui/media-gate`) and its one sanitizer (`$lib/protocol/sanitize`), by
 * reading the source: anything that would load media some other way fails here first, and is added to these lists
 * only once it's known to go through them.
 */
import { describe, expect, it } from 'vitest';

/** Each source file under `src/` but tests and their helpers, by its path from `src/`, as written. */
const sources = Object.entries(import.meta.glob<string>(['/src/**/*.{ts,svelte}', '!/src/**/*.test.ts', '!/src/lib/test/**'], { query: '?raw', import: 'default', eager: true }))
	.map(([path, text]) => ({ path: path.replace(/^\/src\//, ''), text }));

function using(pattern: RegExp): string[] {
	return sources.filter((file) => pattern.test(file.text)).map((file) => file.path).sort();
}

describe('media loads only through the gate', () => {
	it('makes a MediaSrc only in the gate', () => {
		expect(using(/as MediaSrc\b/)).toEqual(['lib/ui/media-gate.ts']);
	});

	it('asks where media may load from only in the gate (streams, their own: only from the server)', () => {
		expect(using(/\bembedMedia\(/)).toEqual(['lib/protocol/embeds.ts', 'lib/ui/media-gate.ts']);
		expect(using(/\bsameOriginMedia\(/)).toEqual(['lib/components/embeds/EmbedStream.svelte', 'lib/protocol/embeds.ts', 'lib/ui/media-gate.ts']);
	});

	it('loads media only in the design components that take a MediaSrc for it', () => {
		// Each of these takes its image, video or audio as a `MediaSrc` prop, which only the gate makes.
		expect(using(/<(?:img|video|audio|source|track|picture|image)\b|\bposter=|\bsrcset=/)).toEqual([
			'lib/design/components/AttachmentTile.svelte',
			'lib/design/components/Avatar.svelte',
			'lib/design/components/BackendRail.svelte',
			'lib/design/components/ConnectHeader.svelte',
			'lib/design/components/ConnectPage.svelte',
			'lib/design/components/EmbedCard.svelte',
			'lib/design/components/EmbedUpload.svelte',
			'lib/design/components/MediaViewer.svelte',
			'lib/design/components/MentionPicker.svelte',
			'lib/design/components/ReactionBar.svelte',
			'lib/design/components/SidebarHead.svelte',
			// A custom emoji's tag, written into markup that `sanitizeHtml` then asks the gate about.
			'lib/protocol/markdown.ts'
		]);
	});

	it('frames a page only where the viewer clicks to load it, as they would follow a link', () => {
		expect(using(/<iframe\b/)).toEqual(['lib/design/components/EmbedFrame.svelte']);
	});

	it('casts nothing around the types, where a URL could slip into a MediaSrc unasked', () => {
		// None of these is media: a service worker's scope, the emoji picker's element, WebAuthn's options, a test socket.
		expect(using(/\bas unknown as\b/)).toEqual(['lib/components/EmojiPopover.svelte', 'lib/preview/memory-socket.ts', 'lib/protocol/webauthn.ts', 'service-worker.ts']);
	});
});

describe('markup from anyone else goes through the one sanitizer', () => {
	it('sanitizes only there (and in code highlighting, which keeps nothing but spans)', () => {
		expect(using(/from 'dompurify'/)).toEqual(['lib/protocol/sanitize.ts', 'lib/ui/highlight.ts']);
		expect(sources.find((file) => file.path === 'lib/ui/highlight.ts')?.text).toContain("{ ALLOWED_TAGS: ['span'], ALLOWED_ATTR: ['class'] }");
	});

	it('inserts markup only where it was made by the sanitizer', () => {
		// Each of these inserts what `renderMarkdown`, `renderPlain`, `renderBio` or `sanitizeHtml` returned.
		expect(using(/\{@html\b/)).toEqual([
			'lib/components/ConnectScreen.svelte',
			'lib/components/ProfileCard.svelte',
			'lib/components/ThreadDescription.svelte',
			'lib/components/embeds/EmbedStream.svelte',
			'lib/design/components/EmbedHtml.svelte',
			'lib/design/components/Message.svelte'
		]);
		expect(using(/\.innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=/)).toEqual(['lib/protocol/sanitize.ts', 'lib/ui/highlight.ts']);
	});
});
