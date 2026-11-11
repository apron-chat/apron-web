import { DEVICES, expect, test } from './fixtures';

/** Adding people to a room from the member list's + (§4.2.2), with the people picker New private conversation uses. */

test.use(DEVICES.desktop);

test('Add member adds everyone picked, and keeps who the server refused picked, with why', async ({ preview, page }) => {
	await preview.open();
	await preview.openRoom('engineering');
	await page.getByRole('button', { name: 'Add member', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Add people to engineering' });
	const field = dialog.getByRole('combobox', { name: 'Add', exact: true });
	await expect(field).toBeFocused();
	await field.fill('grace');
	await page.keyboard.press('Enter');
	// A @user_id the client doesn't know is offered to add by it.
	await field.fill('@newcomer');
	await expect(dialog.getByRole('option')).toHaveText([/Add by @user_id: @newcomer/]);
	await page.keyboard.press('Enter');
	await dialog.getByRole('button', { name: 'Add 2 people', exact: true }).click();

	// Grace's add changes the room's record, which leaves the dialog open for the rest.
	await expect(dialog.getByRole('alert')).toHaveText('Couldn’t add newcomer: Unknown user.');
	await expect(dialog.locator('.ap-pick-chip-name')).toHaveText(['newcomer']);
	await expect(page.getByRole('complementary', { name: 'Room member list' }).locator('li.ap-member[data-user="grace"]')).toBeVisible();
	// Who was added is said in the timeline, at their join, not in the member list.
	await expect(page.getByTestId('membership-line').last()).toHaveText(/Grace Hopper joined/);
	await expect(page.getByTestId('room-member-list').getByRole('status')).toHaveCount(0);
});

test('a message (never a command) mentioning people who aren’t here, by name or by a role no one here holds, asks to add them first', async ({ preview, page }) => {
	await preview.open();
	await preview.openRoom('engineering');
	const prompt = page.getByTestId('mention-add-prompt');
	const member = (id: string) => page.getByRole('complementary', { name: 'Room member list' }).locator(`li.ap-member[data-user="${id}"]`);
	await preview.composer().click();

	await test.step('a command, and a mention of someone here, go without asking', async () => {
		await page.keyboard.type('/shrug @grace ');
		await page.keyboard.press('Enter');
		await preview.waitForSent('command', (p) => p.body?.text?.startsWith('/shrug @grace'));
		await expect(prompt).toHaveCount(0);
		// The preview's server doesn't know /shrug, so the draft comes back with its notice.
		await expect(preview.composer()).toContainText('/shrug');
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.press('Backspace');
		await page.keyboard.type('@linus hi');
		await page.keyboard.press('Enter');
		await preview.waitForSent('message', (p) => p.body?.text === '@linus hi');
		await expect(prompt).toHaveCount(0);
	});

	await test.step('held back, with the focus left in the composer, so no key typed on adds anyone', async () => {
		await page.keyboard.type('@grace hi');
		await page.keyboard.press('Enter');
		await expect(prompt).toContainText('Add Grace Hopper to engineering?');
		await expect(preview.composer()).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(prompt).toBeVisible();
		expect(await preview.sent('room_join')).toEqual([]);
	});

	await test.step('Escape, or typing on, puts it away with the draft; Send without adding sends it as it is', async () => {
		await page.keyboard.press('Escape');
		await expect(prompt).toHaveCount(0);
		await expect(preview.composer()).toContainText('hi');
		await page.keyboard.press('Enter');
		await expect(prompt).toBeVisible();
		await page.keyboard.type(' there');
		await expect(prompt).toHaveCount(0);
		await page.keyboard.press('Enter');
		await prompt.getByRole('button', { name: 'Send without adding' }).click();
		await preview.waitForSent('message', (p) => p.body?.text === '@grace hi there');
		await expect(prompt).toHaveCount(0);
		await expect(member('grace')).toHaveCount(0);
		expect(await preview.sent('room_join')).toEqual([]);
	});

	await test.step('Add and send adds them, then sends', async () => {
		await page.keyboard.type('@grace can you look?');
		await page.keyboard.press('Enter');
		await prompt.getByRole('button', { name: 'Add and send' }).click();
		const sent = await preview.waitForSent('message', (p) => p.body?.text === '@grace can you look?');
		expect(sent).toMatchObject({ room_id: 'engineering', body: { mentions: ['grace'] } });
		await expect(member('grace')).toBeVisible();
		await expect(prompt).toHaveCount(0);
		await expect(preview.composer()).toBeFocused();
	});

	await test.step('a role someone here holds mentions them; one no one here holds asks about its holders, mentioned once added', async () => {
		await page.keyboard.type('@&admin hi ');
		await page.keyboard.press('Enter');
		const toAdmins = await preview.waitForSent('message', (p) => p.body?.text?.startsWith('@&admin hi'));
		expect(toAdmins.body.mentions).toEqual(['ada']);
		await expect(prompt).toHaveCount(0);
		await page.keyboard.type('@&moderator please review ');
		await page.keyboard.press('Enter');
		await expect(prompt).toContainText('Add Margaret Hamilton to engineering?');
		await prompt.getByRole('button', { name: 'Add and send' }).click();
		const toModerators = await preview.waitForSent('message', (p) => p.body?.text?.startsWith('@&moderator please review'));
		expect(toModerators.body.mentions).toEqual(['margaret']);
		await expect(member('margaret')).toBeVisible();
	});

});

test.describe('with a slow server', () => {
	// Adding others is held until the test lets it through (`releaseJoins`), rather than played as a round trip: the
	// steps below must happen while it's under way, and on a busy machine they can take longer than a delay allows.
	// Released, it's answered at once, so what follows comes after it, as the test means.
	test.use({ knobs: { holdJoins: true } });

	test('while Add and send adds them, Send waits in that room only, and a draft changed or left meanwhile isn’t sent', async ({ preview, page }) => {
		await preview.open();
		await preview.openRoom('engineering');
		const prompt = page.getByTestId('mention-add-prompt');
		await preview.composer().click();
		await page.keyboard.type('@grace hi');
		await page.keyboard.press('Enter');
		await prompt.getByRole('button', { name: 'Add and send' }).click();
		await expect(prompt.getByRole('button', { name: 'Adding…' })).toBeDisabled();
		// Send again while adding: nothing more goes, and no second ask.
		await preview.composer().click();
		await page.keyboard.press('Enter');
		await page.keyboard.type(', never mind');
		await preview.releaseJoins();
		await expect(page.locator('li.ap-member[data-user="grace"]')).toBeVisible();
		await expect(prompt).toHaveCount(0);
		expect(await preview.sent('room_join')).toHaveLength(1);
		// The draft changed while adding: it stays, unsent, for Send.
		await expect(preview.composer()).toContainText('hi, never mind');
		expect(await preview.sent('message')).toEqual([]);

		// Gone elsewhere while adding: Send works there, and the draft waits in its room, asking no more.
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.press('Backspace');
		await page.keyboard.type('@margaret hey');
		await page.keyboard.press('Enter');
		await prompt.getByRole('button', { name: 'Add and send' }).click();
		await preview.openRoom('general');
		await preview.composer().click();
		await page.keyboard.type('hello');
		await page.keyboard.press('Enter');
		await preview.waitForSent('message', (p) => p.body?.text === 'hello');
		await expect.poll(async () => (await preview.sent('room_join')).length).toBe(2);
		await preview.releaseJoins();
		await preview.openRoom('engineering');
		await expect(page.locator('li.ap-member[data-user="margaret"]')).toBeVisible();
		await expect(preview.composer()).toContainText('hey');
		await expect(prompt).toHaveCount(0);
		expect((await preview.sent('message')).map((p) => p.body?.text)).toEqual(['hello']);
	});
});

test('a second click on a member closes their profile, on their name or anywhere else on their row', async ({ preview, page }) => {
	await preview.open();
	const list = await preview.showMembers();
	const card = page.getByTestId('profile-card');
	const name = list.locator('button[data-user-id="linus"]');
	await name.click();
	await expect(card).toBeVisible();
	await name.click();
	await expect(card).toBeHidden();

	// The row's end, past the name: a press there mustn't close the card for its click to open it again.
	await name.click();
	await expect(card).toBeVisible();
	const row = (await list.locator('li[data-user="linus"]').boundingBox())!;
	await page.mouse.click(row.x + row.width - 3, row.y + row.height / 2);
	await expect(card).toBeHidden();
});

test.describe('on a phone, signed in to an account', () => {
	test.use({ ...DEVICES.phone, knobs: { account: true } });

	test('a tap on a member opens their profile, and a long press their menu, over the member list, where Remove from room asks, then removes them', async ({ preview, page }) => {
		await preview.open();
		const list = await preview.showMembers();
		const grace = list.locator('li.ap-member[data-user="grace"]');
		await preview.press(grace);
		await expect(page.getByRole('dialog', { name: /Grace Hopper/ })).toBeVisible();
		await expect(page.getByRole('menu')).toHaveCount(0);
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog', { name: /Grace Hopper/ })).toHaveCount(0);
		await preview.hold(grace);
		const menu = page.getByRole('menu', { name: 'Grace Hopper' });
		await expect(menu.getByRole('menuitem')).toHaveText(['Profile', 'Direct message', 'Remove from room']);
		// Over the member list, which is an overlay here: what's at its middle is the menu.
		const box = (await menu.boundingBox())!;
		expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('[role="menu"]'), [box.x + box.width / 2, box.y + box.height / 2])).toBe(true);
		page.once('dialog', (dialog) => dialog.accept());
		await preview.press(menu.getByRole('menuitem', { name: 'Remove from room' }));
		await preview.waitForSent('room_leave', (p) => p.user_id === 'grace');
		await expect(list.locator('li.ap-member[data-user="grace"]')).toHaveCount(0);
	});
});
