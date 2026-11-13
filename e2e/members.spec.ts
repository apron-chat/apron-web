import type { Page } from '@playwright/test';
import { DEVICES, expect, test, type Preview } from './fixtures';

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

test('a message (never a command) mentioning people who aren’t here, by name or by a role no one here holds, adds them first as the line over the composer says', async ({ preview, page }) => {
	await preview.open();
	await preview.openRoom('engineering');
	const hint = page.getByTestId('mention-outside-hint');
	const tick = page.getByTestId('mention-outside-add');
	const member = (id: string) => page.getByRole('complementary', { name: 'Room member list' }).locator(`li.ap-member[data-user="${id}"]`);
	await preview.composer().click();

	await test.step('a command, and a mention of someone here, go without asking', async () => {
		await page.keyboard.type('/shrug @grace hi');
		// A command says itself what it does with whom it names: no line offers to add them.
		await expect(page.getByTestId('mention-outside-hint')).toHaveCount(0);
		await page.keyboard.press('Enter');
		await preview.waitForSent('command', (p) => p.body?.text?.startsWith('/shrug @grace'));
		// The preview's server doesn't know /shrug, so the draft comes back with its notice.
		await expect(preview.composer()).toContainText('/shrug');
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.press('Backspace');
		await page.keyboard.type('@linus hi');
		await page.keyboard.press('Enter');
		await preview.waitForSent('message', (p) => p.body?.text === '@linus hi');
	});

	await test.step('a line over the composer names who isn’t here as they’re mentioned, ticked to add them: Send adds them, then sends', async () => {
		await page.keyboard.type('@grace can you look?');
		await expect(hint).toContainText('Not in this room, add them so they’ll see the mention? Grace Hopper');
		await expect(tick).toBeChecked();
		await expect(preview.composer()).toBeFocused();
		await page.keyboard.press('Enter');
		await preview.waitForSent('room_join', (p) => p.user_id === 'grace');
		const sent = await preview.waitForSent('message', (p) => p.body?.text === '@grace can you look?');
		expect(sent).toMatchObject({ room_id: 'engineering', body: { mentions: ['grace'] } });
		await expect(member('grace')).toBeVisible();
		await expect(hint).toHaveCount(0);
		await expect(preview.composer()).toBeFocused();
	});

	await test.step('unticked, it goes as it is, and the next draft starts ticked again', async () => {
		await page.keyboard.type('@margaret hi');
		await tick.uncheck();
		await preview.composer().click();
		// Typing on keeps the choice.
		await page.keyboard.type(' there');
		await expect(tick).not.toBeChecked();
		await page.keyboard.press('Enter');
		await preview.waitForSent('message', (p) => p.body?.text?.startsWith('@margaret hi'));
		expect((await preview.sent('room_join')).map((p) => p.user_id)).toEqual(['grace']);
		await page.keyboard.type('@margaret again');
		await expect(tick).toBeChecked();
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.press('Backspace');
	});

	await test.step('a role someone here holds mentions them; the line names the holders of one no one here holds, and Send adds them', async () => {
		await page.keyboard.type('@&admin hi ');
		await expect(hint).toHaveCount(0);
		await page.keyboard.press('Enter');
		const toAdmins = await preview.waitForSent('message', (p) => p.body?.text?.startsWith('@&admin hi'));
		expect(toAdmins.body.mentions).toEqual(['ada']);
		await page.keyboard.type('@&moderator please review ');
		await expect(hint).toContainText('Margaret Hamilton (moderator)');
		await expect(tick).toBeChecked();
		await page.keyboard.press('Enter');
		const toModerators = await preview.waitForSent('message', (p) => p.body?.text?.startsWith('@&moderator please review'));
		expect(toModerators.body.mentions).toEqual(['margaret']);
		await expect(member('margaret')).toBeVisible();
		await expect(hint).toHaveCount(0);
	});

});

test.describe('a draft naming someone who isn’t here, and a role no one here holds', () => {
	const setUp = async (preview: Preview, page: Page) => {
		await preview.open();
		await preview.openRoom('engineering');
		await preview.composer().click();
		await page.keyboard.type('@gr');
		await page.keyboard.press('Tab');
		await page.keyboard.type('and @&moderator please review ');
		const hint = page.getByTestId('mention-outside-hint');
		await expect(hint).toContainText('Grace Hopper and Margaret Hamilton (moderator)');
		return { hint, tick: hint.getByTestId('mention-outside-add') };
	};

	test('ticked, Send adds them all, then sends, mentioning the role’s holders', async ({ preview, page }) => {
		const { tick } = await setUp(preview, page);
		await expect(tick).toBeChecked();
		await page.keyboard.press('Enter');
		const sent = await preview.waitForSent('message', (p) => p.body?.text?.includes('please review'));
		expect((await preview.sent('room_join')).map((p) => p.user_id)).toEqual(['grace', 'margaret']);
		expect([...sent.body.mentions].sort()).toEqual(['grace', 'margaret']);
	});

	test('a role held only outside is a chip, offered faded; chips that won’t reach anyone grey while unticked', async ({ preview, page }) => {
		await preview.open();
		await preview.openRoom('engineering');
		await preview.composer().click();
		await page.keyboard.type('@&mo');
		const option = page.getByTestId('mention-picker').getByRole('option', { name: /moderator/ });
		await expect(option).toHaveClass(/ap-mpick-out/);
		await expect(option).toContainText('Not in room');
		await page.keyboard.press('Tab');
		const role = preview.composer().locator('.ap-mention[data-role="moderator"]');
		await expect(role).toBeVisible();
		await page.keyboard.type('and ');
		await page.keyboard.type('@gr');
		await page.keyboard.press('Tab');
		const grace = preview.composer().locator('.ap-mention[data-user-id="grace"]');
		const hint = page.getByTestId('mention-outside-hint');
		await expect(hint).toContainText('Margaret Hamilton (moderator) and Grace Hopper');
		// Ticked, they'll be added, so the mentions reach them.
		await expect(role).not.toHaveClass(/ap-mention-quiet/);
		await expect(grace).not.toHaveClass(/ap-mention-quiet/);
		await hint.getByTestId('mention-outside-add').uncheck();
		await expect(role).toHaveClass(/ap-mention-quiet/);
		await expect(grace).toHaveClass(/ap-mention-quiet/);
		await hint.getByTestId('mention-outside-add').check();
		await expect(role).not.toHaveClass(/ap-mention-quiet/);
		await preview.composer().click();
		await page.keyboard.press('End');
		await page.keyboard.type(' hi');
		await page.keyboard.press('Enter');
		const sent = await preview.waitForSent('message', (p) => p.body?.text?.includes('hi'));
		expect(sent.body.text).toContain('@&moderator');
		expect([...sent.body.mentions].sort()).toEqual(['grace', 'margaret']);
		expect((await preview.sent('room_join')).map((p) => p.user_id).sort()).toEqual(['grace', 'margaret']);
	});

	test('a role written in code names no one: the line drops it as it is typed, and Send adds no one for it', async ({ preview, page }) => {
		await preview.open();
		await preview.openRoom('engineering');
		await preview.composer().click();
		const hint = page.getByTestId('mention-outside-hint');
		await page.keyboard.type('type `@&moderator` to reach them');
		await expect(page.getByTestId('message-list')).toBeVisible();
		await expect(hint).toHaveCount(0);
		await page.keyboard.press('Enter');
		await preview.waitForSent('message', (p) => p.body?.text?.startsWith('type `@&moderator`'));
		expect(await preview.sent('room_join')).toEqual([]);
	});

	test('unticked, it goes as it is, adding no one', async ({ preview, page }) => {
		const { tick } = await setUp(preview, page);
		await tick.uncheck();
		await preview.composer().click();
		await page.keyboard.press('Enter');
		await preview.waitForSent('message', (p) => p.body?.text?.includes('please review'));
		expect(await preview.sent('room_join')).toEqual([]);
	});
});

test.describe('with a slow server', () => {
	// Adding others is held until the test lets it through (`releaseJoins`), rather than played as a round trip: the
	// steps below must happen while it's under way, and on a busy machine they can take longer than a delay allows.
	// Released, it's answered at once, so what follows comes after it, as the test means.
	test.use({ knobs: { holdJoins: true } });

	test('while Send adds who it mentions, Send waits in that room only, and a draft changed or left meanwhile isn’t sent', async ({ preview, page }) => {
		await preview.open();
		await preview.openRoom('engineering');
		const hint = page.getByTestId('mention-outside-hint');
		await preview.composer().click();
		await page.keyboard.type('@grace hi');
		await page.keyboard.press('Enter');
		await expect(hint).toContainText('Adding…');
		await expect(hint.getByTestId('mention-outside-add')).toBeDisabled();
		// Send again while adding: nothing more goes, and no second ask.
		await preview.composer().click();
		await page.keyboard.press('Enter');
		await page.keyboard.type(', never mind');
		await preview.releaseJoins();
		await expect(page.locator('li.ap-member[data-user="grace"]')).toBeVisible();
		expect(await preview.sent('room_join')).toHaveLength(1);
		// The draft changed while adding: it stays, unsent, for Send.
		await expect(preview.composer()).toContainText('hi, never mind');
		expect(await preview.sent('message')).toEqual([]);

		// Gone elsewhere while adding: Send works there, and the draft waits in its room, asking no more.
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.press('Backspace');
		await page.keyboard.type('@margaret hey');
		await page.keyboard.press('Enter');
		await expect(hint).toContainText('Adding…');
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
