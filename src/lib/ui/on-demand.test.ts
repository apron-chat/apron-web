import { describe, expect, it, vi } from 'vitest';
import { onDemandEach, onDemand } from './on-demand';

describe('onDemand', () => {
	it('shares the load under way, then what it loaded', async () => {
		const load = vi.fn(async () => 'chunk');
		const get = onDemand(load);
		const [first, second] = [get(), get()];
		expect(first).toBe(second);
		expect(await first).toBe('chunk');
		expect(await get()).toBe('chunk');
		expect(load).toHaveBeenCalledOnce();
	});

	it('tells whoever asked of a failure, then asks again next time', async () => {
		const load = vi.fn().mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue('chunk');
		const get = onDemand(load);
		await expect(get()).rejects.toThrow('Failed to fetch');
		expect(await get()).toBe('chunk');
		expect(load).toHaveBeenCalledTimes(2);
	});
});

describe('onDemandEach', () => {
	it('loads each key once, and one that failed again', async () => {
		const load = vi.fn(async (key: string) => {
			if (key === 'rust' && load.mock.calls.filter(([asked]) => asked === 'rust').length === 1) throw new Error('Failed to fetch');
			return key.toUpperCase();
		});
		const get = onDemandEach(load);
		expect(await get('js')).toBe('JS');
		expect(await get('js')).toBe('JS');
		await expect(get('rust')).rejects.toThrow();
		expect(await get('rust')).toBe('RUST');
		expect(load.mock.calls.map(([key]) => key)).toEqual(['js', 'rust', 'rust']);
	});
});
