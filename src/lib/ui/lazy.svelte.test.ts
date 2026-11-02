import { describe, expect, it, vi } from 'vitest';
import { Lazy } from './lazy.svelte';

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

	it('waits on past a failed load for one that works', async () => {
		const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('code');
		const lazy = new Lazy<string>(load);
		const arrived = lazy.whenLoaded();
		await expect(lazy.load()).rejects.toThrow('offline');
		await lazy.load();
		await expect(arrived).resolves.toBe('code');
	});
});
