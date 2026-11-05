import { describe, expect, it } from 'vitest';
import type { VersionChecked } from './storage';
import { RETRY_AFTER_MS, STALE_AFTER_MS, VersionGate } from './version-check';

const DAY = 24 * 60 * 60 * 1000;

/** A gate for deploy `version` on a device that last found `stored` the latest, with the network answering `latest`. */
function setup(version: string, stored: VersionChecked | undefined, latest: string | undefined) {
	const state = {
		now: 100 * DAY,
		stored,
		latest,
		fetches: 0,
		reloads: 0,
		notices: 0,
		reloadedFor: new Set<string>()
	};
	const gate = new VersionGate({
		version,
		now: () => state.now,
		load: () => state.stored,
		save: (checked) => (state.stored = checked),
		latest: async () => {
			state.fetches += 1;
			return state.latest;
		},
		reloadedFor: (target) => {
			if (state.reloadedFor.has(target)) return true;
			state.reloadedFor.add(target);
			return false;
		},
		reload: () => (state.reloads += 1),
		notice: () => (state.notices += 1)
	});
	return { gate, state };
}

/** A connection a reload would cut nothing short of, and one it would. */
const yes = () => true;
const no = () => false;

/** Whether `promise` has settled, once what's queued has run. */
async function settled(promise: Promise<void>): Promise<boolean> {
	let done = false;
	void promise.then(() => (done = true));
	for (let i = 0; i < 10; i += 1) await Promise.resolve();
	return done;
}

describe('checking for a newer deploy before connecting', () => {
	it('checks nothing on the first visit, or for a deploy newer than the one noted (pages load from the network), and notes it the latest', () => {
		for (const stored of [undefined, { version: '200', at: 0 }]) {
			const { gate, state } = setup('300', stored, '400');
			expect(gate.beforeConnect(yes)).toBeUndefined();
			expect(state).toMatchObject({ fetches: 0, stored: { version: '300', at: state.now } });
		}
	});

	it('checks nothing within three days of the last check', () => {
		const { gate, state } = setup('200', { version: '200', at: 100 * DAY - STALE_AFTER_MS + 1 }, '300');
		expect(gate.beforeConnect(yes)).toBeUndefined();
		expect(state.fetches).toBe(0);
	});

	it('after three days, checks first, and connects once this is found still the latest', async () => {
		const { gate, state } = setup('200', { version: '200', at: 100 * DAY - STALE_AFTER_MS }, '200');
		const waiting = gate.beforeConnect(yes);
		expect(waiting).toBeDefined();
		expect(await settled(waiting!)).toBe(true);
		expect(state).toMatchObject({ fetches: 1, reloads: 0, notices: 0, stored: { version: '200', at: state.now } });
		// Checked just now: the next connection doesn't wait.
		expect(gate.beforeConnect(yes)).toBeUndefined();
	});

	it('after three days, reloads into a newer deploy without ever letting the connection go ahead', async () => {
		const { gate, state } = setup('200', { version: '200', at: 90 * DAY }, '300');
		const waiting = gate.beforeConnect(yes)!;
		expect(await settled(waiting)).toBe(false);
		expect(state).toMatchObject({ fetches: 1, reloads: 1, stored: { version: '300', at: state.now } });
		// Asked again meanwhile (the page's client, after `hooks.client.ts`): the same wait, not another check.
		expect(gate.beforeConnect(yes)).toBe(waiting);
		expect(state.fetches).toBe(1);
	});

	it('checks at once when another tab found a newer deploy, whenever that was', async () => {
		const { gate, state } = setup('200', { version: '300', at: 100 * DAY - 1000 }, '300');
		expect(await settled(gate.beforeConnect(yes)!)).toBe(false);
		expect(state.reloads).toBe(1);
	});

	it('connects after a rollback: an older deploy found the latest goes ahead, rather than reloading into itself', async () => {
		const { gate, state } = setup('200', { version: '300', at: 100 * DAY - 1000 }, '200');
		expect(await settled(gate.beforeConnect(yes)!)).toBe(true);
		expect(state).toMatchObject({ reloads: 0, notices: 0, stored: { version: '200' } });
	});

	it('reloads once per deploy: if that brought back the same old page, it offers the reload and connects', async () => {
		const { gate, state } = setup('200', { version: '200', at: 0 }, '300');
		state.reloadedFor.add('300');
		expect(await settled(gate.beforeConnect(yes)!)).toBe(true);
		expect(state).toMatchObject({ reloads: 0, notices: 1 });
	});

	it('where a reload would cut something short, offers a newer deploy and connects; a later connection it wouldn’t reloads, without checking again', async () => {
		const { gate, state } = setup('200', { version: '200', at: 0 }, '300');
		expect(await settled(gate.beforeConnect(no)!)).toBe(true);
		expect(state).toMatchObject({ fetches: 1, reloads: 0, notices: 1 });
		// Still in use: it connects at once.
		expect(gate.beforeConnect(no)).toBeUndefined();
		// Nothing in use now (back from a long absence): it reloads, from what it found.
		expect(await settled(gate.beforeConnect(yes)!)).toBe(false);
		expect(state).toMatchObject({ fetches: 1, reloads: 1, notices: 1 });
	});

	it('asks, as the check ends, every connection waiting on it whether a reload would cut it short', async () => {
		// One that joins and would be cut short (the page's client, with a pushed room to open) holds the reload.
		const first = setup('200', { version: '200', at: 0 }, '300');
		const waiting = first.gate.beforeConnect(yes)!;
		expect(first.gate.beforeConnect(no)).toBe(waiting);
		expect(await settled(waiting)).toBe(true);
		expect(first.state).toMatchObject({ fetches: 1, reloads: 0, notices: 1 });
		// One that could reload as it asked, but not by the end (disconnected meanwhile): no reload either.
		const second = setup('200', { version: '200', at: 0 }, '300');
		let free = true;
		const pending = second.gate.beforeConnect(() => free)!;
		free = false;
		expect(await settled(pending)).toBe(true);
		expect(second.state).toMatchObject({ reloads: 0, notices: 1 });
	});

	it('takes a deploy newer than the one noted as the latest only as the page loads: later, the one noted may be a rollback', async () => {
		const { gate, state } = setup('300', { version: '200', at: 0 }, '200');
		expect(gate.beforeConnect(yes)).toBeUndefined();
		expect(state.stored).toEqual({ version: '300', at: state.now });
		// Another tab, on the rollback, finds 200 the latest: this one's next connection checks, and reloads into it.
		state.stored = { version: '200', at: state.now };
		expect(await settled(gate.beforeConnect(yes)!)).toBe(false);
		expect(state).toMatchObject({ fetches: 1, reloads: 1 });
	});

	it('checks when the last check is dated ahead of this clock, which can’t say how long it’s been', async () => {
		const { gate, state } = setup('200', { version: '200', at: 100 * DAY + 1 }, '200');
		expect(await settled(gate.beforeConnect(yes)!)).toBe(true);
		expect(state).toMatchObject({ fetches: 1, stored: { version: '200', at: state.now } });
	});

	it('connects when the check can’t be made, and doesn’t hold the next connections up for a minute, nor longer with the clock set back', async () => {
		const { gate, state } = setup('200', { version: '200', at: 0 }, undefined);
		expect(await settled(gate.beforeConnect(yes)!)).toBe(true);
		expect(state).toMatchObject({ fetches: 1, reloads: 0, stored: { version: '200', at: 0 } });
		state.now += RETRY_AFTER_MS - 1;
		expect(gate.beforeConnect(yes)).toBeUndefined();
		state.now += 1;
		state.latest = '300';
		expect(await settled(gate.beforeConnect(yes)!)).toBe(false);
		expect(state).toMatchObject({ fetches: 2, reloads: 1 });
		// Set back a day after a failed check: it checks again at once.
		const back = setup('200', { version: '200', at: 0 }, undefined);
		await settled(back.gate.beforeConnect(yes)!);
		back.state.now -= DAY;
		back.state.latest = '200';
		expect(await settled(back.gate.beforeConnect(yes)!)).toBe(true);
		expect(back.state.fetches).toBe(2);
	});
});
