/**
 * Test support: Web Storage kept in a `Map`, for code that reads and writes
 * `localStorage`. The map is the test's view of what was stored: seed it,
 * read it back and clear it with the `Map` API.
 *
 *     const values = new Map<string, string>();
 *     beforeEach(() => vi.stubGlobal('localStorage', memoryStorage(values)));
 *     afterEach(() => { values.clear(); vi.unstubAllGlobals(); });
 */
export function memoryStorage(values: Map<string, string> = new Map()): Storage & { values: Map<string, string> } {
	return {
		values,
		get length() {
			return values.size;
		},
		key: (index: number) => [...values.keys()][index] ?? null,
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => void values.set(key, String(value)),
		removeItem: (key: string) => void values.delete(key),
		clear: () => values.clear()
	};
}
