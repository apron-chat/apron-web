import { error } from '@sveltejs/kit';

/** Built only where the preview is (`__APRON_PREVIEW__`, vite.config.ts): a production build has no such page. */
export const prerender = __APRON_PREVIEW__;

export async function load() {
	if (__APRON_PREVIEW__) {
		const { previewWebSocketFactory } = await import('$lib/preview/memory-server');
		return { webSocketFactory: previewWebSocketFactory };
	}
	error(404, 'Not found');
}
