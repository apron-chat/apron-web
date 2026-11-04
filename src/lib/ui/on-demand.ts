/**
 * Code or data fetched on demand (a chunk of its own, such as a dialog, xterm.js or the emoji data), the way every
 * such load here goes: whoever asks shares the one load under way, and once it has worked, what it loaded. One that
 * fails (a deploy replaced the chunk, a dropped connection) is forgotten, so the next ask fetches again, rather than
 * every later one failing with it for the rest of the page's life. The failure still reaches whoever asked.
 */
export function onDemand<T>(load: () => Promise<T>): () => Promise<T> {
	let loading: Promise<T> | undefined;
	return () => {
		if (!loading) {
			const attempt = load();
			loading = attempt;
			attempt.catch(() => {
				if (loading === attempt) loading = undefined;
			});
		}
		return loading;
	};
}

/** `onDemand` for each `key` (a language, a locale): each is loaded once, and one that fails is asked for again. */
export function onDemandEach<K, T>(load: (key: K) => Promise<T>): (key: K) => Promise<T> {
	const loads = new Map<K, () => Promise<T>>();
	return (key) => {
		let loader = loads.get(key);
		if (!loader) {
			loader = onDemand(() => load(key));
			loads.set(key, loader);
		}
		return loader();
	};
}
