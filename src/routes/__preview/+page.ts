import { error } from '@sveltejs/kit';
import { setLiveFetch } from '$lib/protocol/live-text';

/** Built only where the preview is (`__APRON_PREVIEW__`, vite.config.ts): a production build has no such page. */
export const prerender = __APRON_PREVIEW__;

export async function load() {
	if (__APRON_PREVIEW__) {
		const { previewLiveFetch, previewWebSocketFactory } = await import('$lib/preview/memory-server');
		// Its live text (`terminal` and `append` embeds) is served by the in-memory server too: there is no network.
		setLiveFetch(previewLiveFetch);
		return { webSocketFactory: previewWebSocketFactory };
	}
	error(404, 'Not found');
}
