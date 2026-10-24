import { RateLimitError } from '$lib/protocol/client';

/**
 * Lists in the background with `list`, and again once a wait it was refused
 * for (`retry_after`) is over: what it shows (rooms to browse, threads to
 * join) would otherwise stay empty until something else listed. Returns what
 * stops it, for when the listing is no longer wanted.
 */
export function listInBackground(list: () => Promise<unknown>): () => void {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;
	const attempt = () => {
		timer = undefined;
		list().catch((cause: unknown) => {
			if (!stopped && cause instanceof RateLimitError) timer = setTimeout(attempt, Math.max(0, cause.retryAt - Date.now()));
		});
	};
	attempt();
	return () => {
		stopped = true;
		clearTimeout(timer);
	};
}
