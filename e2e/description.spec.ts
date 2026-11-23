import { DEVICES, expect, test, type Preview } from './fixtures';

/**
 * A room's description: its first lines under the header, the whole over the conversation (DescriptionSheet), read and
 * edited there. Put away with its ×, it stays away when someone edits it, and the header's Description is drawn in the
 * description's blue until it's read (`descriptionUpdated` in `src/lib/ui/storage.ts`). Your own edit isn't news to you.
 */

const pinned = (preview: Preview) => preview.page.getByTestId('pane-description');
const button = (preview: Preview) => preview.page.getByTestId('show-description');
const UPDATED = /ap-roomhead-description-updated/;

/** Whether Description is drawn in the description's blue (`--denim`), as the pinned description's icon is. */
const blue = (preview: Preview) => button(preview).evaluate((el) => {
	const probe = document.createElement('span');
	probe.style.color = 'var(--denim)';
	el.parentElement!.append(probe);
	const denim = getComputedStyle(probe).color;
	probe.remove();
	return getComputedStyle(el).color === denim;
});

async function putAway(preview: Preview): Promise<void> {
	await preview.open();
	await expect(pinned(preview)).toBeVisible();
	await preview.page.getByRole('button', { name: 'Hide description' }).click();
	await expect(pinned(preview)).toHaveCount(0);
	await expect(button(preview)).not.toHaveClass(UPDATED);
	expect(await blue(preview)).toBe(false);
}

for (const [device, use] of [['desktop', DEVICES.desktop], ['phone', DEVICES.phone]] as const) {
	test.describe(`a description put away, on ${device}`, () => {
		test.use(use);

		test('stays away when someone edits it, Description marked until it is read, and read again unmarked', async ({ preview }) => {
			await putAway(preview);
			const sheet = preview.page.getByTestId('description-sheet');

			await test.step('someone edits it: still away, and Description turns blue and says why', async () => {
				await preview.describe('general', 'Say hello, and read the **rules**.');
				await expect(button(preview)).toHaveClass(UPDATED);
				await expect(button(preview)).toHaveAccessibleName('Show the room description, updated since you hid it');
				expect(await blue(preview)).toBe(true);
				// Pointing at the name, which opens it too, lights Description but keeps it blue.
				await preview.page.locator('.ap-roomhead-name').hover();
				expect(await blue(preview)).toBe(true);
				await expect(pinned(preview)).toHaveCount(0);
			});

			await test.step('Description shows the whole of it, as it now reads, over the conversation; still put away', async () => {
				await button(preview).click();
				await expect(sheet.getByTestId('sheet-description').locator('strong')).toHaveText('rules');
				await expect(pinned(preview)).toHaveCount(0);
			});

			await test.step('shut again, it is recorded as read: no longer blue', async () => {
				await preview.page.getByRole('button', { name: 'Close description', exact: true }).click();
				await expect(sheet).toHaveCount(0);
				await expect(button(preview)).toBeVisible();
				await expect(button(preview)).not.toHaveClass(UPDATED);
				expect(await blue(preview)).toBe(false);
			});
		});

		test('shows whole from a click on the room’s name or its one-line topic, and shuts on Escape, Back, the name again or a click on the room below', async ({ preview, page }) => {
			await putAway(preview);
			const sheet = page.getByTestId('description-sheet');
			await page.getByTestId('room-description').click();
			await expect(sheet).toBeVisible();
			await page.keyboard.press('Escape');
			await expect(sheet).toHaveCount(0);
			await page.locator('.ap-roomhead-name').click();
			await expect(sheet).toBeVisible();
			await page.goBack();
			await expect(sheet).toHaveCount(0);
			await expect(page.getByTestId('message-list')).toBeVisible();
			// The name that opened it shuts it again.
			await page.locator('.ap-roomhead-name').click();
			await expect(sheet).toBeVisible();
			await page.locator('.ap-roomhead-name').click();
			await expect(sheet).toHaveCount(0);
			if (device === 'desktop') {
				await button(preview).click();
				await expect(sheet).toBeVisible();
				const pane = (await page.locator('main.ap-shell-main').boundingBox())!;
				await page.mouse.click(pane.x + pane.width / 2, pane.y + pane.height - 20);
				await expect(sheet).toHaveCount(0);
			}
		});
	});
}

test.describe('a description put away, edited by you', () => {
	test.use(DEVICES.desktop);

	test('with /topic stays away unmarked, and someone else’s edit after that still marks it', async ({ preview, page }) => {
		await putAway(preview);
		await preview.composer().click();
		await page.keyboard.type('/topic Our own words');
		await page.keyboard.press('Enter');
		await preview.waitForSent('room_set', (params) => params.description === 'Our own words');
		// Put away, the description shows as one line under the title: the edit has come back once it reads there.
		await expect(page.getByTestId('room-description')).toHaveText('Our own words');
		await expect(button(preview)).not.toHaveClass(UPDATED);
		expect(await blue(preview)).toBe(false);
		await expect(pinned(preview)).toHaveCount(0);

		await preview.describe('general', 'Their words');
		await expect(button(preview)).toHaveClass(UPDATED);
	});
});

test.describe('a description read and edited where it shows', () => {
	test.use(DEVICES.desktop);

	test('Read all shows the whole; Edit turns it into its editor in the same place, Save sends it, and once read the first lines retire', async ({ preview, page }) => {
		await preview.open();
		await preview.describe('general', ['Say hello.', '', ...Array.from({ length: 12 }, (_, n) => `- Rule ${n + 1}`)].join('\n'));
		const sheet = page.getByTestId('description-sheet');
		await page.getByRole('button', { name: 'Read all', exact: true }).click();
		await expect(sheet.getByTestId('sheet-description').locator('li')).toHaveCount(12);
		// Under the sheet, the conversation is out of reach until it shuts.
		await expect(page.getByTestId('message-list')).toHaveJSProperty('inert', true);

		await page.getByRole('button', { name: 'Edit room', exact: true }).click();
		const field = sheet.getByRole('textbox', { name: 'Room description', exact: true });
		await expect(field).toBeFocused();
		const title = page.getByRole('textbox', { name: 'Room title', exact: true });
		await expect(title).toHaveValue('general');
		// The title is on the editor's column: their left edges line up.
		const [titleBox, editorBox] = [await title.boundingBox(), await sheet.locator('.ap-mdedit').boundingBox()];
		expect(Math.abs(titleBox!.x - editorBox!.x)).toBeLessThanOrEqual(1);
		await expect(page.locator('.ap-roomhead-draft')).toHaveCount(0);
		await page.keyboard.press('ControlOrMeta+End');
		await page.keyboard.type(' Then read the rules.');
		await expect(page.locator('.ap-roomhead-draft')).toHaveText('Unsaved draft');
		await page.getByRole('button', { name: 'Save', exact: true }).click();
		const saved = await preview.waitForSent('room_set', (p) => p.room_id === 'general');
		// The title unchanged goes back as written (the client resends the record whole).
		expect(saved.title).toBe('general');
		expect(saved.description).toMatch(/Rule 12 Then read the rules\.$/);
		// Saved, it reads again, as saved.
		await expect(sheet.getByTestId('sheet-description')).toContainText('Then read the rules.');
		await expect(title).toHaveCount(0);
		await page.keyboard.press('Escape');
		await expect(sheet).toHaveCount(0);
		await expect(page.getByTestId('message-list')).toHaveJSProperty('inert', false);
		// Read whole, its first lines have done their work: the header's line and Description stand in for them.
		await expect(pinned(preview)).toHaveCount(0);
		await expect(button(preview)).toBeVisible();
		await expect(button(preview)).not.toHaveClass(UPDATED);
	});

	test('Escape steps back from editing to reading, asking before a draft goes; Save asks before replacing someone else’s edit', async ({ preview, page }) => {
		await preview.open();
		const sheet = page.getByTestId('description-sheet');
		await page.getByTestId('room-actions').click();
		await page.getByTestId('edit-room').click();
		await expect(sheet.getByTestId('description-input')).toBeFocused();
		await page.keyboard.press('ControlOrMeta+End');
		await page.keyboard.type(' Mine.');
		const asked: string[] = [];
		page.on('dialog', (dialog) => {
			asked.push(dialog.message());
			void (asked.length === 1 ? dialog.dismiss() : dialog.accept());
		});
		await page.keyboard.press('Escape');
		await expect(sheet.getByTestId('description-input')).toBeVisible();
		expect(asked).toEqual(['Discard your changes to this room?']);

		await preview.describe('general', 'Theirs.');
		await page.getByRole('button', { name: 'Save', exact: true }).click();
		const saved = await preview.waitForSent('room_set', (p) => p.room_id === 'general');
		expect(asked[1]).toBe('Someone changed this room since you started editing it. Replace their changes with yours?');
		expect(saved.description).toMatch(/ Mine\.$/);
	});
});

test.describe('the description over the conversation, as the pane moves on', () => {
	test.use(DEVICES.desktop);

	test('opening another room shuts it without counting that room’s description as read', async ({ preview, page }) => {
		await preview.open();
		await preview.describe('engineering', 'Builds, deploys and the on-call rotation.');
		await page.getByTestId('pane-description').click();
		await expect(page.getByTestId('description-sheet')).toBeVisible();
		await preview.openRoom('engineering');
		await expect(page.getByTestId('description-sheet')).toHaveCount(0);
		// Its first lines show, unread, and general's, shut without reading, stay as they were.
		await expect(pinned(preview)).toHaveText('Builds, deploys and the on-call rotation.');
		await preview.openRoom('general');
		await expect(pinned(preview)).toBeVisible();
	});
});

test.describe('the description edited on a phone', () => {
	test.use(DEVICES.phone);

	test('Back asks before a draft goes; told to stay, Back still shuts it next', async ({ preview, page }) => {
		await preview.open();
		await page.getByTestId('room-actions').click();
		await page.getByTestId('edit-room').click();
		const field = page.getByTestId('description-sheet').getByTestId('description-input');
		await expect(field).toBeFocused();
		await page.keyboard.type('Mine. ');
		let answers = [false, true];
		page.on('dialog', (dialog) => void (answers.shift() ? dialog.accept() : dialog.dismiss()));
		await page.goBack();
		await expect(field).toBeVisible();
		await page.goBack();
		await expect(page.getByTestId('description-sheet')).toHaveCount(0);
		await expect(page.getByTestId('message-list')).toBeVisible();
		expect(answers).toEqual([]);
	});
});

test.describe('a description’s first lines, at the lengths where they just get cut', () => {
	test.use(DEVICES.desktop);

	test('measuring the cut changes no size, so it sets off no ResizeObserver loop', async ({ preview, page }) => {
		await page.addInitScript(() => {
			const seen: string[] = ((window as unknown as { seenErrors: string[] }).seenErrors = []);
			window.addEventListener('error', (event) => seen.push(event.message));
		});
		await preview.open();
		for (const lines of [5, 6, 7, 8, 9]) {
			await preview.describe('general', Array.from({ length: lines }, (_, n) => `Line ${n + 1} of the description`).join('\n\n'));
			await expect(pinned(preview)).toContainText(`Line ${lines} of`);
			await page.waitForTimeout(150);
		}
		expect(await page.evaluate(() => (window as unknown as { seenErrors: string[] }).seenErrors)).toEqual([]);
	});
});

test.describe('the description’s Preview while it’s edited', () => {
	test.use(DEVICES.desktop);

	test('is set as the description reads, its headings and spacing the same', async ({ preview, page }) => {
		await preview.open();
		await preview.describe('general', 'Say hello.\n\n## House rules\n\n1. Be kind.\n2. Stay on topic.');
		await page.getByTestId('pane-description').click();
		const sheet = page.getByTestId('description-sheet');
		const look = (heading: import('@playwright/test').Locator) => heading.evaluate((el) => {
			const style = getComputedStyle(el);
			return [style.fontSize, style.lineHeight, style.marginTop, style.borderBottomWidth];
		});
		const read = await look(sheet.getByTestId('sheet-description').getByRole('heading', { name: 'House rules' }));
		await page.getByRole('button', { name: 'Edit room', exact: true }).click();
		await sheet.getByRole('radio', { name: 'Preview', exact: true }).click();
		expect(await look(sheet.getByTestId('draft-preview').getByRole('heading', { name: 'House rules' }))).toEqual(read);
	});
});

test.describe('the description read on a phone', () => {
	test.use(DEVICES.phone);

	test('is as tall as it reads, the room dimmed below it, where a tap shuts it; its header holds only its own buttons', async ({ preview, page }) => {
		await preview.open();
		await preview.describe('general', 'Say hello, and keep it kind.');
		await page.getByTestId('pane-description').click();
		const sheet = page.getByTestId('description-sheet');
		await expect(sheet).toBeVisible();
		const [box, pane] = [await sheet.boundingBox(), await page.locator('main.ap-shell-main').boundingBox()];
		expect(box!.height).toBeLessThan(pane!.height / 3);
		await expect(page.getByRole('button', { name: /member list$/ })).toHaveCount(0);
		await page.mouse.click(pane!.x + pane!.width / 2, pane!.y + pane!.height * 0.75);
		await expect(sheet).toHaveCount(0);
		await expect(page.getByRole('button', { name: /member list$/ })).toBeVisible();
	});
});

test.describe('the description read whole', () => {
	test.use(DEVICES.desktop);

	test('folds back into its first lines with ⌃ at its foot, there again once read and on the next visit', async ({ preview, page }) => {
		await preview.open();
		const sheet = page.getByTestId('description-sheet');
		await pinned(preview).click();
		await expect(sheet).toBeVisible();
		await sheet.getByRole('button', { name: 'Fold into preview' }).click();
		await expect(sheet).toHaveCount(0);
		await expect(pinned(preview)).toBeVisible();
		// Shut with × instead, the first lines retire; Description opens it, and ⌃ brings them back.
		await pinned(preview).click();
		await page.getByRole('button', { name: 'Close description' }).click();
		await expect(pinned(preview)).toHaveCount(0);
		await button(preview).click();
		await sheet.getByRole('button', { name: 'Fold into preview' }).click();
		await expect(pinned(preview)).toBeVisible();
		await page.reload();
		await expect(pinned(preview)).toBeVisible();
	});

	test('wears the focus ring opened from the keyboard, not from the pointer', async ({ preview, page }) => {
		await preview.open();
		const body = page.getByTestId('description-sheet').locator('.ap-descsheet-body');
		const ringed = () => body.evaluate((el) => el === document.activeElement && getComputedStyle(el).outlineStyle !== 'none');
		await pinned(preview).click();
		await expect(body).toBeFocused();
		expect(await ringed()).toBe(false);
		// Shut, read: Description opens it from here.
		await page.keyboard.press('Escape');
		// Tabbed to, as the keyboard comes to it.
		await button(preview).focus();
		await page.keyboard.press('Tab');
		await page.keyboard.press('Shift+Tab');
		await expect(button(preview)).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(body).toBeFocused();
		expect(await ringed()).toBe(true);
	});

	test('shut from the keyboard, gives the keyboard back to what opens it again; shut by the pointer, leaves focus be', async ({ preview, page }) => {
		await preview.open();
		const sheet = page.getByTestId('description-sheet');
		const readAll = page.getByRole('button', { name: 'Read all', exact: true });
		const open = async (from: typeof readAll) => {
			await from.focus();
			await page.keyboard.press('Enter');
			await expect(sheet).toBeVisible();
		};
		// ⌃ pressed: folded back, to the first lines' Read all.
		await open(readAll);
		await sheet.getByRole('button', { name: 'Fold into preview' }).focus();
		await page.keyboard.press('Enter');
		await expect(readAll).toBeFocused();
		// Escape: read, the first lines retire, so to Description.
		await open(readAll);
		await page.keyboard.press('Escape');
		await expect(button(preview)).toBeFocused();
		// × pressed: to Description again.
		await open(button(preview));
		await page.getByRole('button', { name: 'Close description' }).focus();
		await page.keyboard.press('Enter');
		await expect(button(preview)).toBeFocused();
		// A click on the room below: focus stays where it was.
		await button(preview).click();
		const pane = (await page.locator('main.ap-shell-main').boundingBox())!;
		await page.mouse.click(pane.x + pane.width / 2, pane.y + pane.height - 20);
		await expect(sheet).toHaveCount(0);
		await expect(button(preview)).not.toBeFocused();
	});

	test('pointing at the room’s name, which opens it, lights Description as pointing at Description does', async ({ preview, page }) => {
		await putAway(preview);
		const background = () => button(preview).evaluate((el) => getComputedStyle(el).backgroundColor);
		const resting = await background();
		await button(preview).hover();
		const hovered = await background();
		expect(hovered).not.toBe(resting);
		await page.locator('.ap-roomhead-name').hover();
		await expect.poll(background).toBe(hovered);
		await page.getByTestId('message-list').hover();
		await expect.poll(background).toBe(resting);
	});
});

test.describe('the description on a wide window', () => {
	test.use({ viewport: { width: 1920, height: 900 } });

	test('starts where the conversation’s text does, in its first lines and read whole, its icon in the corner of both', async ({ preview, page }) => {
		await preview.open();
		const left = (locator: ReturnType<typeof page.locator>) => locator.first().evaluate((el) => Math.round(el.getBoundingClientRect().left));
		const messages = await left(page.getByTestId('message-list').locator('article[data-message-id] .ap-msg-main'));
		const description = pinned(preview);
		expect(await left(description)).toBe(messages);
		await expect(page.locator('.ap-description-icon')).toBeVisible();
		await description.click();
		const sheet = page.getByTestId('description-sheet');
		expect(await left(sheet.getByTestId('sheet-description'))).toBe(messages);
		await expect(sheet.locator('.ap-descsheet-icon')).toBeVisible();
		// Its line still reads well: the column stops at 46rem, short of the wide pane's far edge.
		const width = await sheet.getByTestId('sheet-description').evaluate((el) => el.getBoundingClientRect().width);
		expect(width).toBeLessThanOrEqual(46 * 16);
	});
});
