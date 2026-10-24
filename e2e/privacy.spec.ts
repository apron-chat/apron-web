import { DEVICES, expect, test, type Preview } from './fixtures';

/**
 * Private rooms (§4.2.4) against a server that doesn't keep them: the memory server's `dropPrivate` knob
 * returns a created room or thread without `private`. The app must say so and not open it to post in.
 */

const PRIVACY_LOST = /The server made the new thread visible to people outside this private room/;

async function createRoom(preview: Preview, title: string, { private: isPrivate }: { private: boolean }): Promise<void> {
	const { page } = preview;
	await page.getByRole('button', { name: 'Create room', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByRole('textbox', { name: 'Room title', exact: true }).fill(title);
	if (isPrivate) await dialog.getByRole('checkbox', { name: /^Private/ }).check();
	await dialog.getByRole('button', { name: 'Create room', exact: true }).click();
	await expect(dialog).toBeHidden();
	await preview.waitForSent('room_set', (p) => p.title === title && (isPrivate ? p.private === true : p.private === undefined));
}

async function startThread(preview: Preview, room: string, title: string): Promise<void> {
	const { page } = preview;
	await page.getByRole('button', { name: `New thread in ${room}`, exact: true }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText('Private, like its room');
	await dialog.getByRole('textbox', { name: 'Thread title', exact: true }).fill(title);
	await dialog.getByRole('button', { name: 'Start thread', exact: true }).click();
	await expect(dialog).toBeHidden();
	await preview.waitForSent('room_set', (p) => p.title === title && typeof p.parent_room_id === 'string');
}

test.use(DEVICES.desktop);

test.describe('a server that keeps private rooms', () => {
	test('opens a new thread of a private room to reply in', async ({ preview, page }) => {
		await preview.open();
		await createRoom(preview, 'Secret plans', { private: true });
		await expect(preview.heading()).toHaveText('Secret plans');
		await startThread(preview, 'Secret plans', 'Hidden thread');
		await expect(preview.heading()).toHaveText('Secret plans › Hidden thread');
		await expect(page).toHaveURL(/[?&]thread=/);
		await expect(preview.composer()).toBeEditable();
	});
});

test.describe('a server that drops private from new threads', () => {
	test.use({ knobs: { dropPrivate: 'threads' } });

	test('says so, and keeps the room open rather than the thread', async ({ preview, page }) => {
		await preview.open();
		await createRoom(preview, 'Secret plans', { private: true });
		await expect(preview.heading()).toHaveText('Secret plans');
		await startThread(preview, 'Secret plans', 'Hidden thread');

		await expect(page.getByText(PRIVACY_LOST)).toBeVisible();
		await expect(preview.heading()).toHaveText('Secret plans');
		await expect(page).not.toHaveURL(/[?&]thread=/);
		// No composer for the thread: the one shown still posts to the room.
		await expect(preview.composer()).toHaveAttribute('aria-placeholder', 'Message Secret plans');
		expect((await preview.sent('message')).filter((p) => p.room_id !== undefined && p.room_id.startsWith('thread_'))).toEqual([]);
	});
});

test.describe('a server that drops private from new rooms', () => {
	test.use({ knobs: { dropPrivate: 'rooms' } });

	test('says so, and does not open the room', async ({ preview, page }) => {
		await preview.open();
		await createRoom(preview, 'Secret plans', { private: true });

		await expect(page.getByText(/The server made “Secret plans” an ordinary room that others can see and join/)).toBeVisible();
		await expect(preview.heading()).toHaveText('general');
		await expect(page).toHaveURL(/[?&]room=general(&|$)/);
	});
});
