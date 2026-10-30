import type { Page } from '@playwright/test';
import { NOW } from '../scripts/qa/lib/helpers.js';
import { OFFSITE } from './mock-server';
import { DEVICES, expect, test, type Frame } from './fixtures';

/**
 * History kept on this device (`$lib/history`): a session saved here (a token the server resumes with) keeps
 * its rooms in IndexedDB, and a reload shows what it had and asks the server only for what came since its
 * checkpoint, as a reconnect does. On `/` against a scripted server, since `/__preview` keeps nothing.
 */

test.use(DEVICES.desktop);

const DAY = 24 * 60 * 60 * 1000;
const ada = { user_id: 'ada', name: 'Ada' };
const you = { user_id: 'kept_1', name: 'Kept' };

/** A server with one room of `messages`, a guest sign-in that hands out a token, and a token resume. */
async function keptServer(page: Page, messages: Array<Record<string, unknown>>, frames: Frame[]): Promise<void> {
	await page.route(OFFSITE, (route) => route.abort());
	await page.routeWebSocket(/.*/, (ws) => {
		const latest = () => String(messages.at(-1)!.log_id);
		const general = () => ({ room_id: 'general', title: 'General', log_id: String(messages[0].log_id), latest_log_id: latest(), history_log_id: String(messages[0].log_id), members: [{ user_id: you.user_id }, { user_id: ada.user_id }] });
		ws.onMessage((data) => {
			const frame = JSON.parse(String(data));
			frames.push(frame);
			const reply = (result: unknown) => frame.id !== undefined && ws.send(JSON.stringify({ id: frame.id, result }));
			const params = frame.params ?? {};
			switch (frame.method) {
				case 'ping': return ws.send(JSON.stringify({ method: 'pong' }));
				case 'auth': return reply({ you, token: 'kept-token' });
				case 'room_list': return reply({ joined: [general()], users: [you, ada] });
				case 'history': {
					const after = params.after === undefined ? -Infinity : Number(params.after);
					const before = params.before === undefined ? Infinity : Number(params.before);
					const limit = Math.min(Number(params.limit) || 200, 200);
					const all = messages.filter((message) => Number(message.log_id) >= after && Number(message.log_id) <= before);
					const page = params.after !== undefined ? all.slice(0, limit) : all.slice(-limit);
					return reply({ messages: page, more: all.length > page.length, latest_log_id: latest(), history_log_id: String(messages[0].log_id),
						...(page.length ? { first_log_id: page[0].log_id, last_log_id: page.at(-1)!.log_id } : {}) });
				}
				default:
					if (frame.id !== undefined) reply({});
			}
		});
		ws.send(JSON.stringify({ method: 'server', params: { apron: 10, agent: 'apron-e2e-kept', auth: ['guest', 'token'], ping: 60, capabilities: ['history', 'rooms'] } }));
	});
}

/** How many history databases this device has: one per account on each server. */
function keptServers(page: Page): Promise<number> {
	return page.evaluate(async () => (await indexedDB.databases()).filter((entry) => entry.name?.startsWith('apron-history:')).length);
}

/** How many messages are kept on this device, for every server and account. */
function keptMessages(page: Page): Promise<number> {
	return page.evaluate(async () => {
		let total = 0;
		for (const { name } of await indexedDB.databases()) {
			if (!name?.startsWith('apron-history:')) continue;
			total += await new Promise<number>((resolve) => {
				const request = indexedDB.open(name);
				request.onsuccess = () => {
					const db = request.result;
					if (!db.objectStoreNames.contains('records')) return resolve(0);
					const all = db.transaction('records').objectStore('records').getAll();
					all.onsuccess = () => { resolve(all.result.filter((row: { kind: string }) => row.kind === 'm').length); db.close(); };
				};
				request.onerror = () => resolve(0);
			});
		}
		return total;
	});
}

test('a reload shows what it kept, and asks only for what came since', async ({ page }) => {
	const base = process.env.E2E_URL;
	await page.clock.setFixedTime(NOW);
	const start = NOW.getTime() - 2 * DAY;
	const message = (n: number, text = `Message ${n}`) => ({ message_id: String(start + n * 1000), log_id: String(start + n * 1000), room_id: 'general', from: ada, body: { text } });
	const messages = Array.from({ length: 80 }, (_, n) => message(n));
	const frames: Frame[] = [];
	await keptServer(page, messages, frames);

	await page.goto(`${base}/`);
	await expect(page.getByText('Message 79', { exact: true })).toBeVisible();
	// Written within a couple of seconds, or as the tab hides: the room's checkpoint with its messages.
	await expect.poll(() => keptMessages(page), { timeout: 10_000 }).toBe(80);
	expect(await keptServers(page)).toBe(1);

	messages.push(message(80, 'While you were away'));
	frames.length = 0;
	await page.reload();
	await expect(page.getByText('While you were away')).toBeVisible();
	await expect(page.getByText('Message 79', { exact: true })).toBeVisible();
	const history = frames.filter((frame) => frame.method === 'history').map((frame) => frame.params ?? {});
	expect(history.length).toBeGreaterThan(0);
	expect(history.every((params) => params.after !== undefined)).toBe(true);
	expect(frames.find((frame) => frame.method === 'auth')?.params).toMatchObject({ scheme: 'token' });

	// Kept for 30 days unless changed; keeping nothing removes what is kept.
	await page.getByRole('button', { name: /^Open preferences/ }).click();
	const preferences = page.getByRole('dialog', { name: 'Preferences' });
	await preferences.getByRole('navigation').getByRole('button', { name: 'History' }).click();
	const retention = preferences.getByTestId('history-retention');
	await expect(retention).toHaveValue('30');
	await retention.selectOption('off');
	await expect.poll(() => keptServers(page)).toBe(0);
});

test('search finds a message only this device still has, and opens it where it is', async ({ page }) => {
	const base = process.env.E2E_URL;
	await page.clock.setFixedTime(NOW);
	const start = NOW.getTime() - 2 * DAY;
	const message = (n: number, text = `Message ${n}`) => ({ message_id: String(start + n * 1000), log_id: String(start + n * 1000), room_id: 'general', from: ada, body: { text } });
	const messages = Array.from({ length: 150 }, (_, n) => message(n, n === 3 ? 'The needle in the haystack' : `Message ${n}`));
	const frames: Frame[] = [];
	await keptServer(page, messages, frames);

	await page.goto(`${base}/`);
	await expect(page.getByText('Message 149', { exact: true })).toBeVisible();
	// Scrolled back to the start, so all of it is kept.
	const list = page.getByTestId('message-list');
	await expect(async () => {
		await list.evaluate((el) => (el.scrollTop = 0));
		await expect(page.getByText('Message 0', { exact: true })).toBeVisible({ timeout: 500 });
	}).toPass();
	await expect.poll(() => keptMessages(page), { timeout: 10_000 }).toBe(150);

	// A reload holds only the newest of it: the needle is on this device alone.
	await page.reload();
	await expect(page.getByText('Message 149', { exact: true })).toBeVisible();
	await expect(page.getByText('The needle in the haystack')).toHaveCount(0);
	frames.length = 0;
	await page.keyboard.press('ControlOrMeta+f');
	const search = page.getByRole('dialog', { name: 'Search local history' });
	await search.getByRole('combobox').fill('NEEDLE in  the hay');
	const results = search.getByTestId('search-results');
	await expect(results.getByRole('option')).toHaveCount(1);
	await expect(results.getByRole('option')).toContainText('General');
	await expect(results.locator('mark')).toHaveText(['needle in the hay']);
	await expect(search.getByRole('status')).toHaveText('1 message found.');
	await page.keyboard.press('Enter');
	await expect(search).toHaveCount(0);
	await expect(page.locator(`article[data-message-id="${start + 3000}"]`)).toBeInViewport();
	// Paged back from this device, not the server.
	expect(frames.filter((frame) => frame.method === 'history' && frame.params?.before !== undefined)).toEqual([]);
});
