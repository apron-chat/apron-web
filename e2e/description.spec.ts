import { DEVICES, expect, test, type Preview } from './fixtures';

/**
 * A room's description put away with its ×: it stays away when someone edits it, and the header's Description wears a
 * small dot until it's brought back (`descriptionUpdated` in `src/lib/ui/storage.ts`). Your own edit isn't news to you.
 */

const pinned = (preview: Preview) => preview.page.getByTestId('pane-description');
const button = (preview: Preview) => preview.page.getByTestId('show-description');
const UPDATED = /ap-roomhead-description-updated/;

/** Whether the dot is drawn: after Description's name, or on its icon where the name is hidden (phones). */
const dotDrawn = (preview: Preview) => button(preview).evaluate((el) => {
	const word = el.querySelector('.ap-roomhead-description-word');
	const onWord = word && getComputedStyle(word).display !== 'none' && getComputedStyle(word, '::after').content !== 'none';
	return Boolean(onWord || getComputedStyle(el, '::after').content !== 'none');
});

async function putAway(preview: Preview): Promise<void> {
	await preview.open();
	await expect(pinned(preview)).toBeVisible();
	await preview.page.getByRole('button', { name: 'Hide description' }).click();
	await expect(pinned(preview)).toHaveCount(0);
	await expect(button(preview)).not.toHaveClass(UPDATED);
	expect(await dotDrawn(preview)).toBe(false);
}

for (const [device, use] of [['desktop', DEVICES.desktop], ['phone', DEVICES.phone]] as const) {
	test.describe(`a description put away, on ${device}`, () => {
		test.use(use);

		test('stays away when someone edits it, Description marked until it is brought back, and put away again unmarked', async ({ preview }) => {
			await putAway(preview);

			await test.step('someone edits it: still away, and Description has its dot and says why', async () => {
				await preview.describe('general', 'Say hello, and read the **rules**.');
				await expect(button(preview)).toHaveClass(UPDATED);
				await expect(button(preview)).toHaveAccessibleName('Show the room description, updated since you hid it');
				expect(await dotDrawn(preview)).toBe(true);
				await expect(pinned(preview)).toHaveCount(0);
			});

			await test.step('brought back, it shows the new text', async () => {
				await button(preview).click();
				await expect(pinned(preview).locator('strong')).toHaveText('rules');
				await expect(button(preview)).toHaveCount(0);
			});

			await test.step('put away again, it is recorded as it now reads: no dot', async () => {
				await preview.page.getByRole('button', { name: 'Hide description' }).click();
				await expect(button(preview)).toBeVisible();
				await expect(button(preview)).not.toHaveClass(UPDATED);
				expect(await dotDrawn(preview)).toBe(false);
			});
		});
	});
}

test.describe('a description put away, edited by you', () => {
	test.use(DEVICES.desktop);

	test('with /topic stays away without a dot, and someone else’s edit after that still marks it', async ({ preview, page }) => {
		await putAway(preview);
		await preview.composer().click();
		await page.keyboard.type('/topic Our own words');
		await page.keyboard.press('Enter');
		await preview.waitForSent('room_set', (params) => params.description === 'Our own words');
		// Put away, the description shows as one line under the title: the edit has come back once it reads there.
		await expect(page.getByTestId('room-description')).toHaveText('Our own words');
		await expect(button(preview)).not.toHaveClass(UPDATED);
		expect(await dotDrawn(preview)).toBe(false);
		await expect(pinned(preview)).toHaveCount(0);

		await preview.describe('general', 'Their words');
		await expect(button(preview)).toHaveClass(UPDATED);
	});
});
