import { DEVICES, expect, test, type Preview } from './fixtures';

/** Deep links and the browser's Back and Forward (`src/lib/ui/address.ts`, the page's history entries). */

async function at(preview: Preview, heading: string, url: RegExp): Promise<void> {
	await expect(preview.heading()).toHaveText(heading);
	await expect(preview.page).toHaveURL(url);
}

test.describe('deep links', () => {
	test.use(DEVICES.desktop);

	test('a room link opens that room, and a thread link the thread under its room', async ({ preview }) => {
		await preview.open('#room=engineering');
		await at(preview, 'engineering', /#room=engineering$/);
		await expect(preview.message('Engineering room preview')).toBeVisible();
		await preview.open('#room=general&thread=thread_deploy');
		await at(preview, 'general › Deploy checklist', /#room=general&thread=thread_deploy$/);
		await expect(preview.message('Thread replies are ordinary messages')).toBeVisible();
	});

	test('a message link scrolls to the message and keeps it in the address', async ({ preview, page }) => {
		await preview.open('#room=general&message=1710000000001');
		await expect(preview.message('Welcome to Apron!')).toBeInViewport();
		await expect(page).toHaveURL(/#room=general&message=1710000000001$/);
	});

	test('a place pasted into the open tab goes there without reloading, a room’s closing its open thread', async ({ preview, page }) => {
		await preview.open('#room=general&thread=thread_deploy');
		await page.evaluate(() => ((window as unknown as { stayed: boolean }).stayed = true));
		await page.evaluate(() => (location.hash = 'room=engineering'));
		await at(preview, 'engineering', /#room=engineering$/);
		await page.evaluate(() => (location.hash = 'room=general&thread=thread_deploy'));
		await at(preview, 'general › Deploy checklist', /#room=general&thread=thread_deploy$/);
		await page.evaluate(() => (location.hash = 'room=general'));
		await at(preview, 'general', /#room=general$/);
		expect(await page.evaluate(() => (window as unknown as { stayed?: boolean }).stayed)).toBe(true);
	});

	test('a link to a message that is not there says so', async ({ preview, page }) => {
		await preview.open('#room=general&message=1710000000099');
		await expect(page.getByText('The linked message isn’t available here.')).toBeVisible();
		await at(preview, 'general', /#room=general$/);
	});
});

test.describe('Back and Forward', () => {
	test.use(DEVICES.desktop);

	test('move between the rooms and threads visited, in order', async ({ preview, page }) => {
		await preview.open();
		await at(preview, 'general', /#room=general$/);
		await preview.openThread('thread_deploy');
		await at(preview, 'general › Deploy checklist', /#room=general&thread=thread_deploy$/);
		await preview.openRoom('engineering');
		await at(preview, 'engineering', /#room=engineering$/);

		await page.goBack();
		await at(preview, 'general › Deploy checklist', /#room=general&thread=thread_deploy$/);
		await page.goBack();
		await at(preview, 'general', /#room=general$/);
		await page.goForward();
		await at(preview, 'general › Deploy checklist', /#room=general&thread=thread_deploy$/);
		await page.goForward();
		await at(preview, 'engineering', /#room=engineering$/);
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
		await at(preview, 'general › Deploy checklist', /#room=general&thread=thread_deploy$/);
		await expect(preview.message('Thread replies are ordinary messages')).toBeVisible();
		await expect(page.getByTestId('join-room')).toBeVisible();
		expect((await preview.sent('room_join')).filter((p) => p.room_id === 'thread_deploy')).toEqual([]);
	});
});

test.describe('the rooms list on a phone', () => {
	test.use(DEVICES.phone);

	test('is a history entry of its own: Back returns to the room, a pick takes its place', async ({ preview, page }) => {
		await preview.open('#room=engineering');
		await expect(page.getByTestId('room-list')).toBeHidden();
		await preview.roomsPane();
		await page.goBack();
		await expect(page.getByTestId('room-list')).toBeHidden();
		await at(preview, 'engineering', /#room=engineering$/);

		// Picking a room from the list replaces the list's entry: Back then goes to the room before, not the list.
		await preview.openRoom('general');
		await at(preview, 'general', /#room=general$/);
		await page.goBack();
		await at(preview, 'engineering', /#room=engineering$/);
		await expect(page.getByTestId('room-list')).toBeHidden();
	});

	test('leaves a sliver of the room in reach at its edge, faded and inert, which returns to it', async ({ preview, page }) => {
		await preview.open('#room=engineering');
		await preview.roomsPane();
		const list = (await page.getByTestId('room-list').boundingBox())!;
		const viewport = page.viewportSize()!;
		const main = page.getByRole('main', { name: 'Conversation', includeHidden: true });
		// The conversation keeps its width behind the list, only its start in view, and out of the keyboard's and screen readers' way.
		expect(list.x + list.width).toBeLessThan(viewport.width - 30);
		await expect(main).toHaveAttribute('inert', '');
		expect((await main.boundingBox())!.width).toBe(viewport.width);
		await preview.press(page.locator('.ap-shell-peek'));
		await expect(page.getByTestId('room-list')).toBeHidden();
		await expect(main).not.toHaveAttribute('inert');
		await at(preview, 'engineering', /#room=engineering$/);
	});

	test('a message arriving in the room behind it stays unread until the room shows again', async ({ preview, page }) => {
		await preview.open('#room=engineering');
		await preview.roomsPane();
		await preview.post('engineering', 'ada', 'While the list is open');
		await expect(page).toHaveTitle('(1) Apron');
		await preview.press(page.locator('.ap-shell-peek'));
		await expect(page).toHaveTitle('Apron');
	});

	test('a swipe across it toward the left returns to the room, but not a swipe down it or a hold before moving', async ({ preview, page, context }) => {
		await preview.open('#room=engineering');
		await preview.roomsPane();
		const cdp = await context.newCDPSession(page);
		const swipe = async (from: { x: number; y: number }, by: { x: number; y: number }, holdMs = 0) => {
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
			if (holdMs) await page.waitForTimeout(holdMs);
			for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (by.x * i) / 6, y: from.y + (by.y * i) / 6 }] });
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		};
		const list = page.getByTestId('room-list');
		const box = (await list.boundingBox())!;
		const from = { x: box.x + box.width * 0.7, y: box.y + box.height + 120 };
		await swipe(from, { x: 0, y: -120 });
		await swipe(from, { x: -150, y: 0 }, 450);
		await page.waitForTimeout(200);
		await expect(list).toBeVisible();
		await swipe(from, { x: -150, y: 10 });
		await expect(list).toBeHidden();
		await at(preview, 'engineering', /#room=engineering$/);
	});
});

test.describe('Preferences in the address', () => {
	test.use(DEVICES.desktop);

	const section = (preview: Preview, name: string) =>
		preview.page.getByRole('dialog', { name: 'Preferences' }).getByRole('button', { name, exact: true });

	test('each section opened is an entry Back and Forward step through, and closing returns to the room', async ({ preview, page }) => {
		await preview.open('#room=general');
		await page.getByRole('button', { name: /^Open preferences/ }).click();
		await expect(page).toHaveURL(/#room=general&preferences=profile$/);
		await section(preview, 'Notifications').click();
		await expect(page).toHaveURL(/#room=general&preferences=notifications$/);
		await section(preview, 'Media').click();
		await expect(page).toHaveURL(/#room=general&preferences=media$/);
		await page.goBack();
		await expect(page).toHaveURL(/#room=general&preferences=notifications$/);
		await expect(section(preview, 'Notifications')).toHaveAttribute('aria-current', 'page');
		await page.goForward();
		await expect(section(preview, 'Media')).toHaveAttribute('aria-current', 'page');
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog', { name: 'Preferences' })).toHaveCount(0);
		await at(preview, 'general', /#room=general$/);
		// Closing went Back past them: Forward reopens the last section, Back closes it again.
		await page.goForward();
		await expect(section(preview, 'Profile')).toHaveAttribute('aria-current', 'page');
		await page.goBack();
		await expect(page.getByRole('dialog', { name: 'Preferences' })).toHaveCount(0);
		await at(preview, 'general', /#room=general$/);
	});

	test('a link to a section opens it, and closing leaves the room in the address', async ({ preview, page }) => {
		await preview.open('#room=engineering&preferences=history');
		await expect(section(preview, 'History')).toHaveAttribute('aria-current', 'page');
		await expect(page.getByRole('dialog', { name: 'Preferences' }).getByTestId('history-retention')).toBeVisible();
		await page.getByRole('button', { name: 'Close preferences' }).click();
		await expect(page.getByRole('dialog', { name: 'Preferences' })).toHaveCount(0);
		await at(preview, 'engineering', /#room=engineering$/);
	});
});
