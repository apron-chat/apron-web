// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

/** The first fetch of highlight.js fails, as after a deploy replaced its chunk; the next one works. */
const fetches = vi.hoisted(() => ({ count: 0 }));
vi.mock('highlight.js/lib/core', async (original) => {
	fetches.count += 1;
	if (fetches.count === 1) throw new Error('Failed to fetch dynamically imported module');
	return original();
});

describe('highlight', () => {
	it('asks for highlight.js again after it failed to load, rather than never highlighting', async () => {
		const { highlight } = await import('./highlight');
		await expect(highlight('const a = 1;', 'javascript')).rejects.toThrow();
		expect(await highlight('const a = 1;', 'javascript')).toContain('hljs-');
		expect(fetches.count).toBe(2);
	});
});
