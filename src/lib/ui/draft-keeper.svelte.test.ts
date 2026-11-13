import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { memoryStorage } from '$lib/test/storage';
import { notifyAccount } from './notify-scopes';
import { DraftKeeper, draftServer, forgetDrafts } from './draft-keeper.svelte';
import { PaneDrafts } from './pane-drafts.svelte';
import { draftKeys, loadDraft } from './storage';

const values = new Map<string, string>();
const storage = memoryStorage(values);
/** A server of its own for each test: what this page last wrote is remembered by key across them. */
let tests = 0;
let server = '';
const key = (roomId: string, at = server) => JSON.stringify([at, roomId]);
const account = (userId: string, at = server) => notifyAccount(at, userId);
const guest = (at = server) => notifyAccount(at, undefined);

/** A visit: a page's drafts and their keeper, as the page makes them, with whose drafts are as `owners` says. */
function visit(owners = new Map<string, string>([[server, account('ada')]]), keeps = () => true) {
	const keeper = new DraftKeeper(keeps, (at) => owners.get(at));
	return { keeper, drafts: new PaneDrafts(keeper), owners };
}

function type(drafts: PaneDrafts, text: string): void {
	drafts.text = text;
	drafts.saveText();
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal('localStorage', storage);
	server = `wss://chat${++tests}.example/`;
});

afterEach(() => {
	values.clear();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('DraftKeeper', () => {
	it('writes a draft being typed at most every second, as it is then, and at once as the page is left', () => {
		const page = visit();
		page.drafts.open(key('general'));
		type(page.drafts, 'H');
		vi.advanceTimersByTime(600);
		type(page.drafts, 'Half');
		vi.advanceTimersByTime(399);
		expect(loadDraft(key('general'))).toBeUndefined();
		// Typing on doesn't put the write off: it comes a second after the first change, with the latest.
		type(page.drafts, 'Half a');
		vi.advanceTimersByTime(1);
		expect(loadDraft(key('general'))).toEqual({ draft: { text: 'Half a' }, owner: account('ada') });
		type(page.drafts, 'Half a thought');
		page.drafts.setReply('m1');
		page.keeper.flush();
		expect(loadDraft(key('general'))?.draft).toEqual({ text: 'Half a thought', reply: 'm1' });

		const next = visit();
		next.drafts.open(key('general'));
		expect([next.drafts.text, next.drafts.reply]).toEqual(['Half a thought', 'm1']);
		// Sent: it goes.
		next.drafts.clear(key('general'));
		next.keeper.flush();
		expect(draftKeys()).toEqual([]);
	});

	it('keeps a change however it is made: a preview removed, text set from outside', () => {
		const page = visit();
		page.drafts.open(key('general'));
		type(page.drafts, 'see https://a.example/');
		page.drafts.dismissed = ['https://a.example/'];
		page.keeper.flush();
		expect(loadDraft(key('general'))?.draft.dismissed).toEqual(['https://a.example/']);
		page.drafts.text = 'see https://a.example/ @ada';
		page.keeper.flush();
		expect(loadDraft(key('general'))?.draft.text).toBe('see https://a.example/ @ada');
	});

	it('keeps each draft in its own item, and writes only what changed', () => {
		const page = visit();
		page.drafts.open(key('general'));
		type(page.drafts, 'one');
		page.drafts.open(key('random'));
		type(page.drafts, 'two');
		page.keeper.flush();
		expect(draftKeys().sort()).toEqual([key('general'), key('random')]);
		const setItem = vi.spyOn(storage, 'setItem');
		// Moving between panes changes nothing to write.
		page.drafts.open(key('general'));
		page.drafts.open(key('random'));
		page.keeper.flush();
		expect(setItem).not.toHaveBeenCalled();
		type(page.drafts, 'two, more');
		page.keeper.flush();
		expect(setItem.mock.calls.map(([item]) => item)).toEqual([`apron.draft:${key('random')}`]);
	});

	it('keeps the drafts written last, past the most it keeps', () => {
		const page = visit();
		for (let n = 0; n < 201; n++) {
			vi.setSystemTime(1_000_000 + n);
			page.drafts.open(key(`room${n}`));
			type(page.drafts, `draft ${n}`);
			page.keeper.flush();
		}
		expect(draftKeys()).toHaveLength(200);
		expect(loadDraft(key('room0'))).toBeUndefined();
		expect(loadDraft(key('room200'))?.draft.text).toBe('draft 200');
	});

	it('reads a draft back only for the account it was written by', () => {
		const ada = visit();
		ada.drafts.open(key('general'));
		type(ada.drafts, 'Ada’s secret');
		ada.keeper.flush();
		// Bob's session, saved on this device: Ada's draft isn't his, before or after he is signed in.
		const bob = visit(new Map([[server, account('bob')]]));
		bob.drafts.open(key('general'));
		expect(bob.drafts.text).toBe('');
		expect(bob.keeper.claim(server, account('bob'))).toBe('same');
		bob.drafts.recallWhere(() => true, false);
		expect(bob.drafts.text).toBe('');
		// And signing in, he forgets what others left there.
		expect(draftKeys()).toEqual([]);
	});

	it('waits to read or write a draft until whose it is is known, then fills the pane if it is still empty', () => {
		const ada = visit();
		ada.drafts.open(key('general'));
		type(ada.drafts, 'from before');
		ada.drafts.open(key('random'));
		type(ada.drafts, 'random, before');
		ada.keeper.flush();

		// A session saved without saying whose: nothing is read, or written, until it is signed in.
		const page = visit(new Map());
		page.drafts.open(key('general'));
		expect(page.drafts.text).toBe('');
		page.drafts.open(key('random'));
		type(page.drafts, 'typed meanwhile');
		page.keeper.flush();
		expect(loadDraft(key('random'))?.draft.text).toBe('random, before');
		page.owners.set(server, account('ada'));
		expect(page.keeper.claim(server, account('ada'))).toBe('same');
		page.drafts.recallWhere((each) => draftServer(each) === server, false);
		// What was typed meanwhile stays, and is kept; the pane left empty gets what was kept for it.
		expect(page.drafts.text).toBe('typed meanwhile');
		page.keeper.flush();
		expect(loadDraft(key('random'))?.draft.text).toBe('typed meanwhile');
		page.drafts.open(key('general'));
		expect(page.drafts.text).toBe('from before');
	});

	it('carries a guest’s drafts to the account it signs in as, and drops another account’s', () => {
		const owners = new Map([[server, guest()]]);
		const page = visit(owners);
		page.drafts.open(key('general'));
		type(page.drafts, 'as a guest');
		page.keeper.flush();
		expect(loadDraft(key('general'))?.owner).toBe(guest());
		// The guest's leave others' drafts alone.
		expect(page.keeper.claim(server, guest())).toBe('same');

		owners.set(server, account('ada'));
		expect(page.keeper.claim(server, account('ada'))).toBe('carried');
		page.drafts.recallWhere((each) => draftServer(each) === server, true);
		expect(page.drafts.text).toBe('as a guest');
		page.keeper.flush();
		expect(loadDraft(key('general'))).toEqual({ draft: { text: 'as a guest' }, owner: account('ada') });

		// Ada's session ends and Bob's begins: hers go from the page, and from the device as he signs in.
		owners.set(server, account('bob'));
		expect(page.keeper.claim(server, account('bob'))).toBe('dropped');
		page.drafts.forgetWhere((each) => draftServer(each) === server);
		page.drafts.recallWhere((each) => draftServer(each) === server, true);
		page.keeper.flush();
		expect(page.drafts.text).toBe('');
		expect(draftKeys()).toEqual([]);
	});

	it('keeps whose a draft is through clearing history while typing, so no one else gets it', () => {
		const page = visit();
		page.drafts.open(key('general'));
		type(page.drafts, 'secret');
		page.keeper.flush();
		forgetDrafts(server, account('ada'));
		expect(draftKeys()).toEqual([]);
		type(page.drafts, 'secret, still typed');
		page.keeper.flush();
		expect(loadDraft(key('general'))?.owner).toBe(account('ada'));
		// Her session ends elsewhere; a guest, then Bob, come to this device.
		const next = visit(new Map([[server, guest()]]));
		next.drafts.open(key('general'));
		expect(next.drafts.text).toBe('');
		next.owners.set(server, account('bob'));
		next.keeper.claim(server, account('bob'));
		next.drafts.recallWhere(() => true, true);
		expect(next.drafts.text).toBe('');
		expect(draftKeys()).toEqual([]);
	});

	it('keeps an account’s drafts as it signs in again, and drops them from the page as a guest takes over', () => {
		const owners = new Map([[server, account('ada')]]);
		const page = visit(owners);
		page.drafts.open(key('general'));
		type(page.drafts, 'mine');
		page.keeper.flush();
		// Her session ran out, and she signs in again with a code: the same account.
		expect(page.keeper.claim(server, account('ada'))).toBe('same');
		page.drafts.recallWhere((each) => draftServer(each) === server, false);
		expect(page.drafts.text).toBe('mine');
		// She signs out, keeping her history: the guest after her sees nothing of hers, and she finds it again.
		owners.set(server, guest());
		expect(page.keeper.claim(server, guest())).toBe('dropped');
		page.drafts.forgetWhere((each) => draftServer(each) === server);
		page.keeper.flush();
		expect(page.drafts.text).toBe('');
		expect(loadDraft(key('general'))?.owner).toBe(account('ada'));
		const again = visit();
		again.drafts.open(key('general'));
		expect(again.drafts.text).toBe('mine');
	});

	it('forgets an account’s drafts with its history, and no other server’s', () => {
		const elsewhere = `${server}elsewhere/`;
		const page = visit(new Map([[server, account('ada')], [elsewhere, account('ada', elsewhere)]]));
		page.drafts.open(key('general'));
		type(page.drafts, 'here');
		page.drafts.open(key('general', elsewhere));
		type(page.drafts, 'there');
		page.keeper.flush();
		forgetDrafts(server, account('bob'));
		expect(draftKeys()).toHaveLength(2);
		forgetDrafts(server, account('ada'));
		expect(draftKeys()).toEqual([key('general', elsewhere)]);
	});

	it('keeps a page’s drafts as whose they were while the session saved on the device goes or changes underneath', () => {
		const owners = new Map([[server, account('ada')]]);
		const page = visit(owners);
		page.drafts.open(key('general'));
		type(page.drafts, 'Ada’s, private');
		page.keeper.flush();
		// Her token expires as the page reconnects (no session saved: a guest's), or another tab signs in as Bob.
		for (const underneath of [guest(), account('bob')]) {
			owners.set(server, underneath);
			page.drafts.open(key('random'));
			type(page.drafts, `typed while held, ${underneath}`);
			page.drafts.open(key('general'));
			page.keeper.flush();
			expect(draftKeys().map((each) => loadDraft(each)?.owner)).toEqual([account('ada'), account('ada')]);
		}
		// Whoever is then signed in, the page's drafts were Ada's: they go.
		expect(page.keeper.claim(server, account('bob'))).toBe('dropped');
		page.drafts.forgetWhere((each) => draftServer(each) === server);
		page.drafts.recallWhere((each) => draftServer(each) === server, true);
		expect(page.drafts.text).toBe('');
		page.drafts.open(key('random'));
		expect(page.drafts.text).toBe('');
		page.keeper.flush();
		expect(draftKeys()).toEqual([]);
		// A guest's visit after hers reads nothing of it either.
		const later = visit(new Map([[server, guest()]]));
		later.drafts.open(key('general'));
		expect(later.drafts.text).toBe('');
	});

	it('keeps nothing while local history is turned off', () => {
		const off = visit(undefined, () => false);
		off.drafts.open(key('general'));
		type(off.drafts, 'not kept');
		vi.advanceTimersByTime(1_000);
		off.keeper.flush();
		expect(values.size).toBe(0);
		expect(off.drafts.unsent).toBe(true);
	});

	it('writes every draft the page holds again as keeping them is turned back on', () => {
		let keeping = true;
		const page = visit(undefined, () => keeping);
		page.drafts.open(key('general'));
		type(page.drafts, 'one');
		page.drafts.open(key('random'));
		type(page.drafts, 'two');
		page.keeper.flush();
		// Turned off: what was kept goes, as history does.
		keeping = false;
		forgetDrafts();
		page.keeper.flush();
		expect(draftKeys()).toEqual([]);
		keeping = true;
		page.keeper.flush();
		expect(draftKeys().sort()).toEqual([key('general'), key('random')]);
	});

	it('tries a refused write again, and says a reload would lose it until one goes, to what follows that', () => {
		const page = visit();
		const said: boolean[] = [];
		const stop = $effect.root(() => {
			$effect(() => void said.push(page.drafts.unsent));
		});
		page.drafts.open(key('a'));
		type(page.drafts, 'a long draft');
		page.drafts.open(key('b'));
		type(page.drafts, 'short');
		flushSync();
		const setItem = storage.setItem;
		vi.spyOn(storage, 'setItem').mockImplementation((item, value) => {
			if (item.endsWith(key('a'))) throw new DOMException('full', 'QuotaExceededError');
			setItem(item, value);
		});
		page.keeper.flush();
		flushSync();
		// B went, A didn't: a reload would lose A, and the banner hears so.
		expect(loadDraft(key('b'))?.draft.text).toBe('short');
		expect(loadDraft(key('a'))).toBeUndefined();
		expect(said.at(-1)).toBe(true);
		vi.restoreAllMocks();
		page.keeper.flush();
		flushSync();
		expect(loadDraft(key('a'))?.draft.text).toBe('a long draft');
		expect(said.at(-1)).toBe(false);
		stop();
	});

	it('says a reload would lose a draft whose account isn’t known yet', () => {
		const page = visit(new Map());
		page.drafts.open(key('general'));
		type(page.drafts, 'whose?');
		page.keeper.flush();
		expect(draftKeys()).toEqual([]);
		expect(page.drafts.unsent).toBe(true);
		page.owners.set(server, account('ada'));
		page.keeper.claim(server, account('ada'));
		page.keeper.flush();
		expect(loadDraft(key('general'))?.draft.text).toBe('whose?');
		expect(page.drafts.unsent).toBe(false);
	});

	it('names the server of a draft key', () => {
		expect(draftServer(key('general'))).toBe(server);
		expect(draftServer('not a key')).toBeUndefined();
	});
});
