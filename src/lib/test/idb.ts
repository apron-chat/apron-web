/**
 * Test support: an in-memory IndexedDB, as much of it as the app uses: open
 * a database (creating its stores on upgrade), then `get`, `put`, `delete`
 * and `clear` on one store per transaction, every request answered on a later
 * microtask as a browser would. `databases` is the test's view of what was
 * stored, by database, then store, then key; values are stored as clones.
 * `failing` makes every open fail, as private browsing or a blocked origin does.
 *
 *     const idb = memoryIdb();
 *     await saveView(server, 'ada', view, idb);
 *     expect(idb.stored('apron-cache', 'views').has(server)).toBe(true);
 */
export interface MemoryIdb extends Pick<IDBFactory, 'open'> {
	databases: Map<string, Map<string, Map<IDBValidKey, unknown>>>;
	/** The keys and values of one store (empty when it doesn't exist). */
	stored(database: string, store: string): Map<IDBValidKey, unknown>;
	failing: boolean;
}

type Handler = ((this: unknown, event: Event) => unknown) | null;

/** A request that settles on a later microtask: `onsuccess` with `result`, or `onerror` with `error`. */
class Request<T> {
	result!: T;
	error: DOMException | null = null;
	onsuccess: Handler = null;
	onerror: Handler = null;
	onupgradeneeded: Handler = null;
	readyState: 'pending' | 'done' = 'pending';

	settle(run: () => T, after?: () => void): this {
		queueMicrotask(() => {
			try {
				this.result = run();
				this.readyState = 'done';
				this.onsuccess?.call(this, new Event('success'));
			} catch (cause) {
				this.error = cause instanceof DOMException ? cause : new DOMException(String(cause), 'UnknownError');
				this.readyState = 'done';
				this.onerror?.call(this, new Event('error'));
			}
			after?.();
		});
		return this;
	}
}

export function memoryIdb(): MemoryIdb {
	const databases = new Map<string, Map<string, Map<IDBValidKey, unknown>>>();
	const idb: MemoryIdb = {
		databases,
		failing: false,
		stored: (database, store) => databases.get(database)?.get(store) ?? new Map(),
		open(name: string) {
			const request = new Request<IDBDatabase>();
			queueMicrotask(() => {
				if (idb.failing) {
					request.error = new DOMException('IndexedDB is unavailable', 'UnknownError');
					request.onerror?.call(request, new Event('error'));
					return;
				}
				const fresh = !databases.has(name);
				const stores = databases.get(name) ?? new Map<string, Map<IDBValidKey, unknown>>();
				databases.set(name, stores);
				request.result = database(stores);
				if (fresh) request.onupgradeneeded?.call(request, new Event('upgradeneeded'));
				request.onsuccess?.call(request, new Event('success'));
			});
			return request as unknown as IDBOpenDBRequest;
		}
	};
	return idb;
}

function database(stores: Map<string, Map<IDBValidKey, unknown>>): IDBDatabase {
	return {
		createObjectStore(name: string) {
			stores.set(name, new Map());
			return {} as IDBObjectStore;
		},
		close() {},
		transaction(name: string) {
			const values = stores.get(name);
			if (!values) throw new DOMException(`No store ${name}`, 'NotFoundError');
			let open = 0;
			const transaction = {
				oncomplete: null as Handler,
				onerror: null as Handler,
				onabort: null as Handler,
				error: null,
				objectStore: () => store
			};
			// The transaction completes once its requests, and those they made, have settled.
			const request = <T>(run: () => T) => {
				open++;
				return new Request<T>().settle(run, () => {
					if (--open === 0) queueMicrotask(() => open === 0 && transaction.oncomplete?.call(transaction, new Event('complete')));
				});
			};
			const store = {
				get: (key: IDBValidKey) => request(() => structuredClone(values.get(key))),
				put: (value: unknown, key: IDBValidKey) => request(() => (values.set(key, structuredClone(value)), key)),
				delete: (key: IDBValidKey) => request(() => void values.delete(key)),
				clear: () => request(() => void values.clear())
			};
			return transaction as unknown as IDBTransaction;
		}
	} as unknown as IDBDatabase;
}
