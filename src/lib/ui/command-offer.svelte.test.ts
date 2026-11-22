import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatClient, ClientSnapshot } from '$lib/protocol/client';
import { memoryStorage } from '$lib/test/storage';
import { Commands, type CommandsHost } from './command-offer.svelte';

const values = new Map<string, string>();
beforeEach(() => vi.stubGlobal('localStorage', memoryStorage(values)));
afterEach(() => {
	values.clear();
	vi.unstubAllGlobals();
});

const settle = () => new Promise((resolve) => setTimeout(resolve));

/** A page's part, recorded, and a server listing `/help` and `/topic clear`. */
function setup(load?: () => Promise<typeof import('./command-tools')>) {
	const host = {
		context: () => ({}),
		caps: () => ({ rooms: true, members: true, append: false }),
		loadReference: vi.fn(async () => undefined),
		put: vi.fn(),
		focus: vi.fn(),
		error: vi.fn()
	} satisfies CommandsHost;
	const listCommands = vi.fn(async () => ({ commands: [{ name: 'help', description: 'Help' }, { name: 'topic clear', description: 'Clear it' }] }));
	const chat = { url: 'wss://chat.example/', listCommands } as unknown as ChatClient;
	const snapshot = (userId: string) => ({ you: { user_id: userId }, passkeySession: true }) as unknown as ClientSnapshot;
	return { host, listCommands, chat, snapshot, commands: new Commands(host, load) };
}

describe('Commands', () => {
	it('follows the list of the latest key only, though its code is still loading when the key changes', async () => {
		const t = setup();
		t.commands.follow(t.chat, t.snapshot('alice'), 'alice');
		t.commands.follow(t.chat, t.snapshot('bob'), 'bob');
		// Asked once, on connecting, for bob's list (an account's, with none kept): alice's follow came to nothing.
		await vi.waitFor(() => expect(t.commands.offer?.ready).toBe(true));
		expect(t.listCommands).toHaveBeenCalledOnce();
		expect(JSON.parse(values.get('apron.commandLists')!)).toHaveProperty(['wss://chat.example/\nbob']);
		expect(Object.keys(JSON.parse(values.get('apron.commandLists')!))).toEqual(['wss://chat.example/\nbob']);
		// The server's, by all the words of a name it lists: apron-web's own `/topic` runs for anything else.
		expect(t.commands.serves('topic clear')).toBe(true);
		expect(t.commands.serves('topic Ship it')).toBe(false);
		expect(t.commands.known).toBe(true);
		// No extension, or signed out or signing in again (the page follows '' then): none of bob's commands are
		// offered or run meanwhile, and `/help` goes to the server.
		t.commands.follow(t.chat, t.snapshot('bob'), '');
		expect(t.commands.offer).toBeUndefined();
		expect(t.commands.serves('topic clear')).toBe(false);
		expect(t.commands.known).toBe(false);
	});

	it('loads its code again where it failed: on the page’s snapshots at most every 30 seconds, and as a command starts at once', async () => {
		let fail = true;
		let now = 1_000_000;
		vi.spyOn(Date, 'now').mockImplementation(() => now);
		const load = vi.fn(() => (fail ? Promise.reject(new Error('offline')) : import('./command-tools')));
		const t = setup(load);
		t.commands.follow(t.chat, t.snapshot('alice'), 'alice');
		await vi.waitFor(() => expect(t.commands.retry).toBeGreaterThan(0));
		expect(t.commands.offer).toBeUndefined();
		// Snapshots meanwhile, while it keeps failing: no other load till 30 seconds have gone.
		t.commands.follow(t.chat, t.snapshot('alice'), 'alice');
		t.commands.follow(t.chat, t.snapshot('alice'), 'alice');
		expect(load).toHaveBeenCalledOnce();
		now += 30_000;
		fail = false;
		// The page follows the same key again while `retry` says so.
		t.commands.follow(t.chat, t.snapshot('alice'), 'alice');
		expect(load).toHaveBeenCalledTimes(2);
		expect(t.commands.retry).toBe(0);
		await vi.waitFor(() => expect(t.commands.offer?.ready).toBe(true));
		expect(t.commands.known).toBe(true);
		expect(t.listCommands).toHaveBeenCalledOnce();

		// Or a command started: `need` loads it and follows the list.
		fail = true;
		const u = setup(() => (fail ? Promise.reject(new Error('offline')) : import('./command-tools')));
		u.commands.follow(u.chat, u.snapshot('carol'), 'carol');
		await vi.waitFor(() => expect(u.commands.retry).toBeGreaterThan(0));
		fail = false;
		u.commands.need();
		await vi.waitFor(() => expect(u.commands.offer?.ready).toBe(true));
		expect(u.commands.serves('topic clear')).toBe(true);
		vi.restoreAllMocks();
	});

	it('says in the reference that the server’s commands couldn’t be loaded where none were had, showing apron-web’s own', async () => {
		const t = setup();
		t.listCommands.mockRejectedValueOnce(new Error('refused'));
		t.commands.follow(t.chat, t.snapshot('alice'), 'alice');
		await vi.waitFor(() => expect(t.commands.reference.loading).toBe(false));
		expect(t.commands.reference.notice).toBe('The server’s commands couldn’t be loaded.');
		expect(t.commands.reference.sections.map((section) => section.title)).toEqual(['Built into the client']);
	});

	it('says while the reference waits for the list, and why it won’t come when the code can’t load', async () => {
		const t = setup(() => Promise.reject(new Error('offline')));
		expect(t.commands.reference).toEqual({ sections: [], loading: true });
		t.commands.follow(t.chat, t.snapshot('alice'), 'alice');
		await vi.waitFor(() => expect(t.commands.reference.error).toMatch(/couldn’t be loaded/));
		expect(t.commands.known).toBe(false);
		expect(t.commands.offer).toBeUndefined();
	});

	it('shows the reference, and says why where its code can’t load', async () => {
		const t = setup();
		t.commands.show();
		expect(t.commands.shown).toBe(true);
		t.host.loadReference.mockRejectedValueOnce(new Error('offline'));
		t.commands.show();
		await settle();
		expect(t.commands.shown).toBe(false);
		expect(t.host.error).toHaveBeenCalledWith(expect.any(Error), 'Unable to show the commands');
	});

	it('puts a command used in the composer once the reference has closed, and else gives the composer the focus back', () => {
		const t = setup();
		t.commands.show();
		t.commands.use('emoji add');
		expect(t.host.put).not.toHaveBeenCalled();
		t.commands.close();
		expect(t.commands.shown).toBe(false);
		expect(t.host.put).toHaveBeenCalledWith('emoji add');
		t.commands.show();
		t.commands.close();
		expect(t.host.focus).toHaveBeenCalledOnce();
		expect(t.host.put).toHaveBeenCalledOnce();
	});
});
