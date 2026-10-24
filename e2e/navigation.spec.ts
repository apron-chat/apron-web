import { DEVICES, expect, test, type Preview } from './fixtures';

/** Deep links and the browser's Back and Forward (`src/lib/ui/address.ts`, the page's history entries). */

async function at(preview: Preview, heading: string, url: RegExp): Promise<void> {
	await expect(preview.heading()).toHaveText(heading);
	await expect(preview.page).toHaveURL(url);
}

test.describe('deep links', () => {
	test.use(DEVICES.desktop);

	test('a room link opens that room, and a thread link the thread under its room', async ({ preview }) => {
		await preview.open('?room=engineering');
		await at(preview, 'engineering', /\?room=engineering$/);
		await expect(preview.message('Engineering room preview')).toBeVisible();
		await preview.open('?room=general&thread=thread_deploy');
		await at(preview, 'general › Deploy checklist', /\?room=general&thread=thread_deploy$/);
		await expect(preview.message('Thread replies are ordinary messages')).toBeVisible();
	});

	test('a message link scrolls to the message and keeps it in the address', async ({ preview, page }) => {
		await preview.open('?room=general#message=1710000000001');
		await expect(preview.message('Welcome to Apron!')).toBeInViewport();
		await expect(page).toHaveURL(/\?room=general#message=1710000000001$/);
	});

	test('a link to a message that is not there says so', async ({ preview, page }) => {
		await preview.open('?room=general#message=1710000000099');
		await expect(page.getByText('The linked message isn’t available here.')).toBeVisible();
		await at(preview, 'general', /\?room=general$/);
	});
});

test.describe('Back and Forward', () => {
	test.use(DEVICES.desktop);

	test('move between the rooms and threads visited, in order', async ({ preview, page }) => {
		await preview.open();
		await at(preview, 'general', /\?room=general$/);
		await preview.openThread('thread_deploy');
		await at(preview, 'general › Deploy checklist', /\?room=general&thread=thread_deploy$/);
		await preview.openRoom('engineering');
		await at(preview, 'engineering', /\?room=engineering$/);

		await page.goBack();
		await at(preview, 'general › Deploy checklist', /\?room=general&thread=thread_deploy$/);
		await page.goBack();
		await at(preview, 'general', /\?room=general$/);
		await page.goForward();
		await at(preview, 'general › Deploy checklist', /\?room=general&thread=thread_deploy$/);
		await page.goForward();
		await at(preview, 'engineering', /\?room=engineering$/);
	});

	test('return to a thread left since, read without joining it', async ({ preview, page }) => {
		await preview.open();
		await preview.openThread('thread_deploy');
		await preview.openRoom('general');
		// The row's Leave shows on hover.
		await page.locator('[data-testid="thread-list"] button[data-thread="thread_deploy"]').hover();
		await page.getByRole('button', { name: 'Leave Deploy checklist', exact: true }).click();
		await preview.waitForSent('room_leave', (p) => p.room_id === 'thread_deploy');
		await expect(page.locator('[data-testid="thread-list"] button[data-thread="thread_deploy"]')).toHaveCount(0);

		await page.goBack();
		await at(preview, 'general › Deploy checklist', /\?room=general&thread=thread_deploy$/);
		await expect(preview.message('Thread replies are ordinary messages')).toBeVisible();
		await expect(page.getByTestId('join-room')).toBeVisible();
		expect((await preview.sent('room_join')).filter((p) => p.room_id === 'thread_deploy')).toEqual([]);
	});
});

test.describe('the rooms list on a phone', () => {
	test.use(DEVICES.phone);

	test('is a history entry of its own: Back returns to the room, a pick takes its place', async ({ preview, page }) => {
		await preview.open('?room=engineering');
		await expect(page.getByTestId('room-list')).toBeHidden();
		await preview.roomsPane();
		await page.goBack();
		await expect(page.getByTestId('room-list')).toBeHidden();
		await at(preview, 'engineering', /\?room=engineering$/);

		// Picking a room from the list replaces the list's entry: Back then goes to the room before, not the list.
		await preview.openRoom('general');
		await at(preview, 'general', /\?room=general$/);
		await page.goBack();
		await at(preview, 'engineering', /\?room=engineering$/);
		await expect(page.getByTestId('room-list')).toBeHidden();
	});
});
