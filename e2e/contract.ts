import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { DEVICES, expect, type Preview, type PreviewKnobs } from './fixtures';

/**
 * The interop contract: what apron-server-go's browser suite finds this app's elements by, read from its specs
 * by `npm run qa -- contract` into `interop-contract.json`. `contract-scenes.spec.ts` walks the app through
 * the states the suite drives it to and records which entries each shows; `contract.spec.ts` then fails for
 * any entry no scene showed, naming the interop tests that rely on it.
 */

export type Name = { roles: string[]; name: string | { regex: string; flags: string }; exact: boolean; at: string[] };
export type Contract = {
	from: string;
	testIds: Record<string, string[]>;
	names: Record<string, Name>;
	selectors: Record<string, string[]>;
	readme: string[];
	/** What the suite only asserts is gone in some state: not required, listed for a reader. */
	absent: { testIds: Record<string, string[]>; names: Record<string, Name>; selectors: Record<string, string[]> };
	dynamic: Record<string, string[]>;
};

export const contract: Contract = JSON.parse(readFileSync(resolve(import.meta.dirname, 'interop-contract.json'), 'utf8'));

/** Where each scene writes what it saw, for the check to read. Emptied by global-setup. */
export const SEEN_DIR = resolve(import.meta.dirname, '../.qa/e2e/contract');

export type Seen = { scene: string; testIds: string[]; names: string[]; selectors: string[]; readme: string[] };
type Observed = Omit<Seen, 'scene'>;

/** What this worker's scenes have seen already, by `kind:key`: no need to look for it again (the check reads the union). */
const seenHere = new Set<string>();

/**
 * Which contract entries the page shows now, of those this worker hasn't seen yet: test ids and selectors
 * attached, names as `getByRole` finds them (visible).
 */
export async function observe(page: Page): Promise<Observed> {
	const has = async (kind: keyof Observed, key: string, locator: () => Locator) => {
		if (seenHere.has(`${kind}:${key}`)) return undefined;
		return (await locator().count().catch(() => 0)) > 0 ? key : undefined;
	};
	const keys = async (checks: Promise<string | undefined>[]) => (await Promise.all(checks)).filter((k): k is string => k !== undefined);
	const named = (entry: Name) => {
		const name = typeof entry.name === 'string' ? entry.name : new RegExp(entry.name.regex, entry.name.flags);
		const [first, ...rest] = entry.roles.map((role) =>
			role === 'label' ? page.getByLabel(name, { exact: entry.exact }) : page.getByRole(role as Parameters<Page['getByRole']>[0], { name, exact: entry.exact })
		);
		return rest.reduce((all, one) => all.or(one), first);
	};
	const seen = {
		testIds: await keys(Object.keys(contract.testIds).map((id) => has('testIds', id, () => page.getByTestId(id)))),
		selectors: await keys(Object.keys(contract.selectors).map((css) => has('selectors', css, () => page.locator(css)))),
		names: await keys(Object.entries(contract.names).map(([key, entry]) => has('names', key, () => named(entry)))),
		// The README's list: a selector, else a name of a textbox or button, or text (`Message deleted`).
		readme: await keys(
			contract.readme.map((item) =>
				has('readme', item, () => (/[[\]=.#]/.test(item) ? page.locator(item) : page.getByRole('textbox', { name: item, exact: true }).or(page.getByRole('button', { name: item, exact: true })).or(page.getByText(item, { exact: true }))))
			)
		)
	};
	for (const kind of Object.keys(seen) as (keyof Observed)[]) for (const key of seen[kind]) seenHere.add(`${kind}:${key}`);
	return seen;
}

/** Adds what the page shows now to the scene's record. */
export function record(scene: string, seen: Observed): void {
	mkdirSync(SEEN_DIR, { recursive: true });
	const file = join(SEEN_DIR, `${scene}.json`);
	let before: Observed = { testIds: [], names: [], selectors: [], readme: [] };
	try {
		before = JSON.parse(readFileSync(file, 'utf8'));
	} catch {
		// The scene's first look.
	}
	const merge = (key: keyof Observed) => [...new Set([...before[key], ...seen[key]])].sort();
	writeFileSync(file, JSON.stringify({ scene, testIds: merge('testIds'), names: merge('names'), selectors: merge('selectors'), readme: merge('readme') }, null, 1));
}

/**
 * The states the interop suite drives the app to, reached on `/__preview` (or, to sign in, on `/` against a
 * scripted server). `look()` records what the page shows at that moment; a scene looks wherever a state passes.
 */
export type Scene = {
	name: string;
	device?: keyof typeof DEVICES;
	knobs?: PreviewKnobs;
	/** `/` against `mockServer` instead of `/__preview`. */
	root?: boolean;
	steps: (preview: Preview, look: () => Promise<void>) => Promise<void>;
};

/** A message's toolbar button (shown on hover or focus), reached as interop's `messageAction` does. */
async function action(message: Locator, name: string): Promise<void> {
	const button = message.getByRole('button', { name, exact: true });
	await expect(async () => {
		await message.scrollIntoViewIfNeeded();
		await message.hover();
		await expect(button).toBeVisible({ timeout: 1000 });
	}).toPass();
	await button.click();
}


async function send(preview: Preview, text: string): Promise<Locator> {
	await preview.composer().click();
	await preview.page.keyboard.insertText(text);
	await preview.page.getByRole('button', { name: 'Send message', exact: true }).click();
	const message = preview.message(text);
	await expect(message).toBeVisible();
	return message;
}

const UPLOADS = { capabilities: ['embed:upload'] } satisfies PreviewKnobs;

export const SCENES: Scene[] = [
	{
		name: 'room',
		steps: async (preview, look) => {
			await expect(preview.page.getByTestId('connection-status')).toHaveText('Connected');
			await look();
			// Scrolled up, the jump to the latest shows.
			await preview.page.getByTestId('message-list').evaluate((el) => (el.scrollTop = 0));
			await expect(preview.page.getByTestId('jump-button')).toBeVisible();
			await look();
		}
	},
	{
		name: 'rich',
		knobs: { seed: 'rich', ...UPLOADS },
		steps: async (preview, look) => {
			const { page } = preview;
			const embeds = preview.message('One embed of each kind');
			await embeds.scrollIntoViewIfNeeded();
			await look();
			// Relayed HTML went through the sanitizer: its script is gone and never ran.
			await expect(embeds.locator('.ap-embed-html b')).toHaveText('Bold');
			await expect(embeds.locator('.ap-embed-html script')).toHaveCount(0);
			expect(await page.evaluate(() => (window as { __embedRan?: boolean }).__embedRan)).toBeUndefined();
			await embeds.getByRole('button', { name: 'Load live view', exact: true }).click();
			// Other Rooms starts open.
			await expect(page.getByTestId('browse-rooms')).toHaveAttribute('aria-expanded', 'true');
			await expect(page.getByTestId('room-directory')).toBeVisible();
			await look();
		}
	},
	{
		name: 'live-text',
		steps: async (preview, look) => {
			const id = await preview.startLive('general', 'ada', 'terminal', { title: 'make test' });
			await preview.liveWrite(id, '$ make test\r\n');
			const terminal = preview.page.getByTestId('terminal-embed');
			await expect(terminal.locator('.ap-embed-livebadge')).toHaveText('Live');
			await expect(terminal.locator('.xterm-rows')).toContainText('$ make test');
			const append = await preview.startLive('general', 'grace', 'append', { body: { text: 'Here is the plan:', format: 'markdown' } });
			await preview.liveWrite(append, ' roll back, then **renew** the cert.');
			const writing = preview.message('Here is the plan:').getByTestId('message-writing');
			await expect(writing).toBeVisible();
			await look();
			// Finished: the terminal says so, and the appended text stays in the body without Writing….
			await preview.liveEnd(id);
			await expect(terminal.locator('.ap-embed-detail')).toHaveText('Finished');
			await preview.liveEnd(append);
			await expect(writing).toHaveCount(0);
			await look();
		}
	},
	{
		name: 'message-actions',
		steps: async (preview, look) => {
			const { page } = preview;
			const mine = await send(preview, 'Mine to edit and delete');
			await mine.hover();
			await look();
			await action(mine, 'Edit message');
			const editor = page.getByRole('textbox', { name: 'Edit message', exact: true });
			await expect(editor).toBeVisible();
			await look();
			await editor.fill('Mine, edited');
			await page.getByRole('button', { name: 'Save changes', exact: true }).click();
			const edited = preview.message('Mine, edited');
			await expect(edited).toBeVisible();
			page.once('dialog', (dialog) => dialog.accept());
			await action(edited, 'More actions');
			await look();
			await edited.getByRole('button', { name: 'Delete message', exact: true }).click();
			await expect(page.getByText('Message deleted', { exact: true })).toBeVisible();
			await look();
		}
	},
	{
		name: 'reply-and-react',
		steps: async (preview, look) => {
			const { page } = preview;
			const welcome = preview.page.locator('article[data-message-id="1710000000001"]');
			await action(welcome, 'Reply to message');
			await expect(page.getByTestId('reply-draft')).toBeVisible();
			await look();
			const reply = await send(preview, 'A reply to the welcome');
			await expect(reply.getByTestId('reply-reference')).toBeVisible();
			await action(reply, 'More actions');
			await look();
			await page.keyboard.press('Escape');
			// Editing a reply offers to drop what it replies to.
			await action(reply, 'Edit message');
			await expect(page.getByRole('textbox', { name: 'Edit message', exact: true })).toBeVisible();
			await look();
			await page.keyboard.press('Escape');
			await action(welcome, 'React');
			const picker = page.getByRole('dialog', { name: 'Emoji picker', exact: true });
			await expect(picker).toHaveAttribute('data-state', 'ready');
			for (const search of ['tada', 'avocado', 'thumbs up']) {
				await picker.locator('em-emoji-picker input[type="search"]').fill(search);
				await look();
			}
			await picker.getByRole('button', { name: '👍', exact: true }).first().click();
			await expect(welcome.getByTestId('reaction-chip')).toBeVisible();
			await look();
		}
	},
	{
		name: 'composer',
		steps: async (preview, look) => {
			const { page } = preview;
			await preview.composer().click();
			await page.keyboard.type('@a');
			await expect(page.getByTestId('mention-picker')).toBeVisible();
			await look();
			await page.keyboard.press('Escape');
			await page.keyboard.press('Backspace');
			await page.keyboard.press('Backspace');
			await page.keyboard.type('/he');
			await expect(page.getByTestId('command-tag')).toBeVisible();
			await look();
			await page.keyboard.type('lp');
			await page.getByRole('button', { name: 'Run command', exact: true }).click();
			await expect(page.getByTestId('notice')).toBeVisible();
			await look();
		}
	},
	{
		name: 'attachments',
		knobs: UPLOADS,
		steps: async (preview, look) => {
			await preview.page.getByTestId('attach-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
			await expect(preview.page.getByTestId('staged-files')).toBeVisible();
			await look();
		}
	},
	{
		name: 'threads',
		steps: async (preview, look) => {
			const { page } = preview;
			await preview.openThread('thread_deploy');
			await look();
			await page.getByTestId('room-actions').click();
			await look();
			await page.getByTestId('edit-room').click();
			const dialog = page.getByRole('dialog', { name: 'Edit thread', exact: true });
			await expect(dialog).toBeVisible();
			await look();
			await dialog.getByRole('textbox', { name: 'Thread title', exact: true }).fill('Deploy checklist, renamed');
			await dialog.getByRole('button', { name: 'Save', exact: true }).click();
			await expect(page.getByTestId('thread-renamed')).toBeVisible();
			await look();
			// Your message in a thread can move back to its room.
			const mine = await send(preview, 'Back to the room with this');
			await mine.click({ modifiers: ['Shift'] });
			await page.getByTestId('selection-bar').getByRole('button', { name: 'Move to thread ▾', exact: true }).click();
			await look();
			await page.keyboard.press('Escape');
			// A thread not joined: read from its card, with Join in the header.
			await preview.openRoom('general');
			await page.locator('[data-testid="thread-card"][data-thread="thread_offsite"]').click();
			await expect(page.getByTestId('join-room')).toBeVisible();
			await look();
		}
	},
	{
		name: 'start-and-move',
		steps: async (preview, look) => {
			const { page } = preview;
			const message = preview.message('Open a thread, react to a message');
			await action(message, 'Start thread');
			await expect(page.getByRole('dialog', { name: 'Start thread', exact: true })).toBeVisible();
			await look();
			await page.keyboard.press('Escape');
			// Only your own messages move: three of them.
			const mine = [];
			for (const text of ['First to move', 'Second to move', 'Third to move']) mine.push(await send(preview, text));
			const bar = page.getByTestId('selection-bar');
			await mine[0].click({ modifiers: ['Shift'] });
			await expect(bar).toContainText('1 message selected');
			for (const message of mine.slice(1)) await message.getByRole('checkbox', { name: 'Select message' }).check();
			await expect(bar).toContainText('3 messages selected');
			await look();
			const menu = bar.getByRole('button', { name: 'Move to thread ▾', exact: true });
			await menu.click();
			await look();
			await menu.click();
			await page.getByTestId('new-thread').click();
			await expect(page.getByRole('dialog', { name: 'Move to a new thread', exact: true })).toBeVisible();
			await look();
		}
	},
	{
		name: 'unread',
		steps: async (preview, look) => {
			const { page } = preview;
			// You read engineering, then others post where you aren't looking: there and in a joined thread.
			await preview.openRoom('engineering');
			await preview.openRoom('general');
			await preview.post('thread_cert', 'linus', 'The managed cert is in.');
			await preview.post('engineering', 'ada', 'Anyone around for a review?');
			await expect(page.getByTestId('thread-unread').first()).toBeVisible();
			await look();
			// A mention of you out of sight turns the jump bar to it.
			await page.getByTestId('message-list').evaluate((el) => (el.scrollTop = 0));
			await expect(page.getByTestId('jump-button')).toBeVisible();
			await preview.post('general', 'ada', { text: '@preview_guest can you look?', format: 'markdown', mentions: ['preview_guest'] });
			await expect(page.getByTestId('jump-button')).toHaveText('Jump to mention');
			await look();
			await preview.openRoom('engineering');
			await expect(page.getByTestId('new-divider')).toBeVisible();
			await look();
		}
	},
	{
		name: 'members',
		steps: async (preview, look) => {
			const { page } = preview;
			await preview.openRoom('engineering');
			await page.getByRole('button', { name: 'Add member', exact: true }).click();
			await page.getByRole('combobox', { name: 'Add', exact: true }).fill('@grace');
			// Enter picks the first match, then (the field emptied) adds who's picked.
			await page.keyboard.press('Enter');
			await page.keyboard.press('Enter');
			await expect(page.getByTestId('membership-line')).toBeVisible();
			await look();
		}
	},
	{
		name: 'leave-and-rejoin',
		steps: async (preview, look) => {
			const { page } = preview;
			await page.getByTestId('room-actions').click();
			page.once('dialog', (dialog) => dialog.accept());
			await page.getByTestId('leave-room').click();
			await expect(page.locator('[data-testid="room-list"] button[data-room="general"]')).toHaveCount(0);
			await expect(page.locator('[data-join="general"]')).toBeVisible();
			await look();
		}
	},
	{
		name: 'profile',
		knobs: { seed: 'rich', capabilities: ['embed:upload', 'status'] },
		steps: async (preview, look) => {
			const { page } = preview;
			// One button: the preferences, at your profile, your status above it.
			await page.getByRole('button', { name: /^Open preferences/ }).click();
			const preferences = page.getByRole('dialog', { name: 'Preferences' });
			await expect(preferences.getByTestId('display-name-input')).toBeVisible();
			await look();
			// With `status`, a status to choose, do not disturb among them.
			await preferences.getByRole('button', { name: /status/i }).click();
			await look();
			// Notifications, a press away in the section navigation.
			await page.keyboard.press('Escape');
			await preferences.getByRole('navigation', { name: 'Preference sections' }).getByRole('button', { name: 'Notifications', exact: true }).click();
			await expect(preferences.getByRole('switch', { name: 'Notifications' })).toBeVisible();
			await look();
		}
	},
	{
		// A server with a title and an avatar (§3.1): the sidebar head shows them over its host.
		name: 'server-look',
		knobs: { server: { title: 'Northwind Ops', avatar: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' } },
		steps: async (preview, look) => {
			await expect(preview.page.locator('img.ap-shell-sidehead-avatar')).toBeVisible();
			await look();
		}
	},
	{
		// An offline member's profile card, which says when they were last seen (§4.5.2).
		name: 'last-seen',
		knobs: { capabilities: ['status'] },
		steps: async (preview, look) => {
			const { page } = preview;
			const list = await preview.showMembers();
			// Their row's menu (a right-click; a click opens the card at once), then its Profile: the card.
			await list.locator('button[data-user-id="linus"]').click({ button: 'right' });
			await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Profile', exact: true })).toBeVisible();
			await look();
			await page.getByRole('menu').getByRole('menuitem', { name: 'Profile', exact: true }).click();
			await expect(page.getByTestId('profile-card').getByTestId('profile-seen')).toBeVisible();
			await look();
		}
	},
	{
		name: 'phone',
		device: 'phone',
		steps: async (preview, look) => {
			await look();
			await preview.roomsPane();
			await look();
			await preview.openThread('thread_deploy');
			await look();
		}
	},
	{
		name: 'sign-in',
		root: true,
		steps: async (preview, look) => {
			const { page } = preview;
			await page.getByRole('button', { name: /^Open preferences/ }).click();
			await look();
			// A guest's Profile offers Sign in, as the composer does where guests can't post.
			await page.getByRole('dialog', { name: 'Preferences' }).getByRole('button', { name: 'Sign in', exact: true }).click();
			const card = page.getByRole('form', { name: 'Sign in' });
			await expect(card).toBeVisible();
			await look();
			await card.getByRole('radiogroup', { name: 'Passkey', exact: true }).getByRole('radio', { name: /^Create account/ }).click();
			await look();
			await card.getByRole('button', { name: 'Cancel', exact: true }).click();
			await expect(card).toBeHidden();
			// The connect screen as it is, from the server pane.
			await page.getByRole('button', { name: /^Server: / }).click();
			await look();
			await page.getByTestId('server-pane').getByRole('button', { name: 'Connect to another server…', exact: true }).click();
			await expect(card).toBeVisible();
			// Another server: Done becomes Connect.
			await page.getByTestId('server-url-input').fill('ws://127.0.0.1:9/ws');
			await look();
		}
	}
];
