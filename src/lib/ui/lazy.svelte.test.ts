import { describe, expect, it, vi } from 'vitest';
import { Lazy, lazyChunk } from './lazy.svelte';

describe('Lazy', () => {
	it('loads once asked, and once only', async () => {
		const load = vi.fn(async () => 'code');
		const lazy = new Lazy(load);
		expect(load).not.toHaveBeenCalled();
		expect(lazy.component).toBeUndefined();
		await expect(lazy.load()).resolves.toBe('code');
		expect(lazy.component).toBe('code');
		expect(load).toHaveBeenCalledTimes(1);
	});

	it('forgets a failed load, so the next ask tries again', async () => {
		const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('code');
		const lazy = new Lazy<string>(load);
		await expect(lazy.load()).rejects.toThrow('offline');
		await expect(lazy.load()).resolves.toBe('code');
		expect(load).toHaveBeenCalledTimes(2);
	});

	it('waits for the code without asking for it, and settles once someone else does', async () => {
		const load = vi.fn(async () => 'code');
		const lazy = new Lazy(load);
		let arrived: string | undefined;
		void lazy.whenLoaded().then((code) => (arrived = code));
		await Promise.resolve();
		await Promise.resolve();
		expect(load).not.toHaveBeenCalled();
		expect(arrived).toBeUndefined();
		await lazy.load();
		await lazy.whenLoaded();
		expect(arrived).toBe('code');
		expect(load).toHaveBeenCalledTimes(1);
	});

	it('gives a host nothing until first asked, then the code from then on', async () => {
		const load = vi.fn(async () => 'code');
		const lazy = new Lazy(load);
		expect(lazy.once(false)).toBeUndefined();
		expect(load).not.toHaveBeenCalled();
		expect(lazy.once(true)).toBeUndefined();
		expect(load).toHaveBeenCalledTimes(1);
		await lazy.whenLoaded();
		expect(lazy.once(true)).toBe('code');
		expect(lazy.once(false)).toBe('code');
		expect(load).toHaveBeenCalledTimes(1);
	});

	it('mounts no host the prefetch loaded until it is asked for', async () => {
		const lazy = new Lazy(async () => 'code');
		await lazy.load();
		expect(lazy.once(false)).toBeUndefined();
		expect(lazy.once(true)).toBe('code');
	});

	it('loads a chunk once for all its parts, so each has it whichever was asked for', async () => {
		const load = vi.fn(async () => ({ a: 'A', b: 'B' }));
		const part = lazyChunk(load);
		const a = part((m) => m.a), b = part((m) => m.b);
		let arrived: string | undefined;
		void b.whenLoaded().then((code) => (arrived = code));
		await expect(a.load()).resolves.toBe('A');
		await b.whenLoaded();
		expect([arrived, b.component]).toEqual(['B', 'B']);
		expect(load).toHaveBeenCalledTimes(1);
	});

	it('forgets a chunk that failed to load, so the next ask fetches it again', async () => {
		const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ a: 'A' });
		const a = lazyChunk<{ a: string }>(load)((m) => m.a);
		await expect(a.load()).rejects.toThrow('offline');
		await expect(a.load()).resolves.toBe('A');
		expect(load).toHaveBeenCalledTimes(2);
	});

	it('waits on past a failed load for one that works', async () => {
		const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('code');
		const lazy = new Lazy<string>(load);
		const arrived = lazy.whenLoaded();
		await expect(lazy.load()).rejects.toThrow('offline');
		await lazy.load();
		await expect(arrived).resolves.toBe('code');
	});
});
