import { flushSync } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { messageRecord } from '$lib/test/builders';
import { LINKED_RETRY_MS, LinkedMessages } from './linked-messages.svelte';

describe('LinkedMessages', () => {
	it('fetches a linked message once, after the turn that asked, and a read follows its arrival', async () => {
		const linked = new LinkedMessages();
		const fetch = vi.fn(async (roomId: string, messageId: string) => messageRecord(messageId, roomId));
		const seen: (string | undefined)[] = [];
		const cleanup = $effect.root(() => {
			$effect(() => {
				seen.push(linked.get('ops', '5')?.message_id);
			});
		});
		flushSync();
		linked.load('ops', '5', fetch);
		linked.load('ops', '5', fetch);
		expect(fetch).not.toHaveBeenCalled();
		await vi.waitFor(() => expect(linked.get('ops', '5')?.room_id).toBe('ops'));
		flushSync();
		expect(fetch).toHaveBeenCalledOnce();
		expect(seen).toEqual([undefined, '5']);
		linked.load('ops', '5', fetch);
		await Promise.resolve();
		expect(fetch).toHaveBeenCalledOnce();
		cleanup();
	});

	it('asks again for one missing or failed only after a while, and drops what was asked before a clear', async () => {
		let now = 0;
		const linked = new LinkedMessages(() => now);
		const fetch = vi.fn<(roomId: string, messageId: string) => Promise<ReturnType<typeof messageRecord> | undefined>>()
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error('forbidden'));
		const settled = async () => {
			for (let turn = 0; turn < 5; turn++) await Promise.resolve();
		};
		linked.load('ops', '5', fetch);
		await settled();
		linked.load('ops', '5', fetch);
		await settled();
		expect(fetch).toHaveBeenCalledOnce();
		now += LINKED_RETRY_MS;
		linked.load('ops', '5', fetch);
		await settled();
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(linked.get('ops', '5')).toBeUndefined();
		// Another server or identity: what was on its way is dropped, and nothing is kept.
		fetch.mockResolvedValueOnce(messageRecord(6, 'ops'));
		linked.load('ops', '6', fetch);
		linked.clear();
		await settled();
		expect(linked.get('ops', '6')).toBeUndefined();
	});
});
