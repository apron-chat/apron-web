import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerCommand } from '$lib/protocol/command-list';
import type { JsonObject } from '$lib/protocol/types';
import { memoryStorage } from '$lib/test/storage';
import { notifyAccount } from './notify-scopes';
import { loadCommandLists, saveCommandLists } from './storage';
import { COMMAND_LIST_AGE_MS, CommandList, keepList, keptList, type KeptCommandList } from './command-list.svelte';

const HELP: ServerCommand[] = [{ name: 'help', description: 'List the commands that you can use' }];
const KICK: ServerCommand[] = [{ name: 'kick', description: 'Remove a user', hint: '<user_id>' }];

/** A list on a clock the test moves, kept in `kept`, asking `list` for each account's commands. */
function setup(kept: Map<string, KeptCommandList> = new Map()) {
	let now = 1_000_000;
	// Stored as one value, as `storage.ts` keeps it: `kept` is the test's view of it.
	const store = {
		read: () => Object.fromEntries(kept),
		write: (lists: Record<string, unknown>) => {
			kept.clear();
			for (const [key, list] of Object.entries(lists)) kept.set(key, list as KeptCommandList);
		}
	};
	const list = vi.fn<() => Promise<JsonObject>>(async () => result(HELP));
	const commands = new CommandList(store, () => now);
	return { commands, list, kept, source: (key = 'ws://a/\nalice', keep = true) => ({ key, keep, list }), later: (ms: number) => (now += ms), now: () => now };
}

/** An `ext:command_list` result listing `commands`. */
const result = (commands: ServerCommand[]) => ({ commands }) as unknown as JsonObject;

const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('CommandList', () => {
	it('asks on connecting only while nothing is kept, and not again within a day of asking', async () => {
		const t = setup();
		t.commands.apply(t.source());
		expect(t.commands.commands).toBeUndefined();
		t.commands.connected();
		expect(t.list).toHaveBeenCalledOnce();
		await settle();
		expect(t.commands.commands).toEqual(HELP);
		expect(t.kept.get('ws://a/\nalice')).toEqual({ commands: HELP, listed: t.now(), asked: t.now() });
		// Kept: a reconnect, or the next visit, asks nothing on connecting.
		t.commands.connected();
		const next = setup(t.kept);
		next.commands.apply(next.source());
		expect(next.commands.commands).toEqual(HELP);
		next.commands.connected();
		expect(next.list).not.toHaveBeenCalled();
		// Asked and refused: connecting asks again only a day later.
		const refused = setup();
		refused.list.mockRejectedValue(new Error('rate limited'));
		refused.commands.apply(refused.source());
		refused.commands.connected();
		await settle();
		expect(refused.commands.failed).toBe(true);
		refused.commands.connected();
		refused.later(COMMAND_LIST_AGE_MS - 1);
		refused.commands.connected();
		expect(refused.list).toHaveBeenCalledOnce();
		refused.later(1);
		refused.commands.connected();
		expect(refused.list).toHaveBeenCalledTimes(2);
	});

	it('asks as the first command of the page starts, showing what is kept meanwhile, and again on /help', async () => {
		const kept = new Map([['ws://a/\nalice', { commands: KICK, listed: 1, asked: 1 }]]);
		const t = setup(kept);
		t.commands.apply(t.source());
		expect(t.commands.commands).toEqual(KICK);
		t.commands.need();
		t.commands.need();
		expect(t.list).toHaveBeenCalledOnce();
		await settle();
		expect(t.commands.commands).toEqual(HELP);
		t.commands.need();
		expect(t.list).toHaveBeenCalledOnce();
		// A day on, the next command asks again; and /help always does.
		t.later(COMMAND_LIST_AGE_MS);
		t.commands.need();
		expect(t.list).toHaveBeenCalledTimes(2);
		await settle();
		t.commands.refresh();
		expect(t.list).toHaveBeenCalledTimes(3);
	});

	it('asks again as a command starts a minute after an ask that failed, keeping what it had', async () => {
		const t = setup(new Map([['ws://a/\nalice', { commands: KICK, listed: 1, asked: 1 }]]));
		t.list.mockRejectedValueOnce(new Error('not sent'));
		t.commands.apply(t.source());
		t.commands.need();
		await settle();
		expect(t.commands.commands).toEqual(KICK);
		expect(t.commands.failed).toBe(false);
		t.commands.need();
		expect(t.list).toHaveBeenCalledOnce();
		t.later(60_000);
		t.commands.need();
		expect(t.list).toHaveBeenCalledTimes(2);
	});

	it('follows the account, and keeps a late answer for the account that asked', async () => {
		const t = setup();
		let answer!: (listed: JsonObject) => void;
		t.list.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
		t.commands.apply(t.source());
		t.commands.need();
		t.commands.apply(t.source('ws://a/\nbob'));
		answer(result(KICK));
		await settle();
		expect(t.commands.commands).toBeUndefined();
		expect(t.kept.get('ws://a/\nalice')?.commands).toEqual(KICK);
		// No extension: nothing is offered or asked.
		t.commands.apply(undefined);
		t.commands.need();
		t.commands.connected();
		t.commands.refresh();
		expect(t.list).toHaveBeenCalledOnce();
	});

	it('keeps a guest’s list for its connection only, and asks for it as a command starts, never on connecting', async () => {
		const t = setup();
		t.commands.apply(t.source('ws://a/\nguest_1', false));
		t.commands.connected();
		expect(t.list).not.toHaveBeenCalled();
		t.commands.need();
		await settle();
		expect(t.commands.commands).toEqual(HELP);
		expect(t.kept.size).toBe(0);
		// The next connection is another user_id: nothing of the last one's shows.
		t.commands.apply(t.source('ws://a/\nguest_2', false));
		expect(t.commands.commands).toBeUndefined();
		// Known to be an account only once it is ready: what is kept for it shows then.
		const kept = setup(new Map([['ws://a/\nalice', { commands: KICK, listed: 1, asked: 1 }]]));
		kept.commands.apply(kept.source('ws://a/\nalice', false));
		expect(kept.commands.commands).toBeUndefined();
		kept.commands.apply(kept.source('ws://a/\nalice', true));
		expect(kept.commands.commands).toEqual(KICK);
	});
});

describe('command lists kept', () => {
	const values = new Map<string, string>();
	beforeEach(() => vi.stubGlobal('localStorage', memoryStorage(values)));
	afterEach(() => {
		values.clear();
		vi.unstubAllGlobals();
	});

	it('keeps each account’s list under apron.commandLists, the ten asked latest, reading only the one asked for as a result is', () => {
		const stored = { read: loadCommandLists, write: saveCommandLists };
		const alice = notifyAccount('wss://chat.example/', 'alice');
		keepList(stored, alice, () => ({ commands: [{ name: 'help', description: 'Help' }], listed: 5, asked: 5 }));
		keepList(stored, notifyAccount('wss://chat.example/', 'bob'), () => ({ asked: 6 }));
		expect(JSON.parse(values.get('apron.commandLists')!)).toEqual({
			'wss://chat.example/\nbob': { asked: 6 },
			'wss://chat.example/\nalice': { commands: [{ name: 'help', description: 'Help' }], listed: 5, asked: 5 }
		});
		expect(keptList(stored, alice)).toEqual({ commands: [{ name: 'help', description: 'Help' }], listed: 5, asked: 5 });
		// Noting an ask keeps what is listed as it was.
		keepList(stored, alice, (kept) => ({ ...kept, asked: 7 }));
		expect(keptList(stored, alice)).toEqual({ commands: [{ name: 'help', description: 'Help' }], listed: 5, asked: 7 });
		for (let i = 0; i < 10; i++) keepList(stored, `other ${i}`, () => ({ asked: 10 + i }));
		expect(keptList(stored, alice)).toBeUndefined();
		expect(Object.keys(JSON.parse(values.get('apron.commandLists')!))).toHaveLength(10);
		// What doesn't read as a list is left out, and its commands as an ext:command_list result's would be.
		values.set('apron.commandLists', JSON.stringify({ a: { asked: 'x' }, b: { asked: 1, commands: [{ name: '/x' }, { name: 'ok' }], listed: 1 }, c: { asked: 2, commands: 'help' } }));
		expect([keptList(stored, 'a'), keptList(stored, 'b'), keptList(stored, 'c')]).toEqual([undefined, { commands: [{ name: 'ok' }], listed: 1, asked: 1 }, { asked: 2 }]);
		values.set('apron.commandLists', '{broken');
		expect(keptList(stored, 'b')).toBeUndefined();
	});

	it('keeps at most 150,000 characters of lists: the ones asked longest ago go, and an account’s too large keeps only when it was asked', () => {
		const stored = { read: loadCommandLists, write: saveCommandLists };
		const big = (n: number) => ({ commands: Array.from({ length: n }, (_, i) => ({ name: `c${i}`, description: 'd'.repeat(400) })), listed: 1, asked: 1 });
		keepList(stored, 'old', () => ({ ...big(200), asked: 1 }));
		keepList(stored, 'mid', () => ({ ...big(150), asked: 2 }));
		keepList(stored, 'new', () => ({ ...big(150), asked: 3 }));
		expect(Object.keys(JSON.parse(values.get('apron.commandLists')!)).sort()).toEqual(['mid', 'new']);
		expect(values.get('apron.commandLists')!.length).toBeLessThanOrEqual(150_000);
		// Counted as written, quotes and punctuation too: one exactly at the limit is kept whole, one a character past it not.
		const fit = (extra: number) => {
			const entry = { commands: [{ name: 'c', description: '' }], listed: 1, asked: 9 };
			const pad = 150_000 - JSON.stringify({ edge: entry }).length + extra;
			return { ...entry, commands: [{ name: 'c', description: 'd'.repeat(pad) }] };
		};
		keepList(stored, 'edge', () => fit(0));
		expect(values.get('apron.commandLists')!.length).toBe(150_000);
		keepList(stored, 'edge', () => fit(1));
		expect(JSON.parse(values.get('apron.commandLists')!)).toEqual({ edge: { asked: 9 } });
		keepList(stored, 'huge', () => ({ ...big(500), asked: 4 }));
		expect(JSON.parse(values.get('apron.commandLists')!).huge).toEqual({ asked: 4 });
	});
});

describe('a list asked for anew', () => {
	it('stays as it was, out of date, when the ask fails', async () => {
		const t = setup(new Map([['ws://a/\nalice', { commands: KICK, listed: 1, asked: 1 }]]));
		t.list.mockRejectedValueOnce(new Error('refused'));
		t.commands.apply(t.source());
		t.commands.refresh();
		await settle();
		expect(t.commands.commands).toEqual(KICK);
		expect([t.commands.stale, t.commands.failed]).toEqual([true, false]);
		// Noted that it was asked for, so connecting holds back.
		expect(t.kept.get('ws://a/\nalice')).toEqual({ commands: KICK, listed: 1, asked: t.now() });
		t.commands.refresh();
		await settle();
		expect(t.commands.stale).toBe(false);
	});
});

