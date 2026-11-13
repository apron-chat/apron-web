import { DEVICES, expect, test } from './fixtures';

/**
 * Unsent drafts kept on this device (`DraftKeeper`): the app's own route, whose storage is real, against the scripted
 * server. A reload, as of a crashed or closed tab, brings each room's draft back, and one emptied stays empty.
 * Sending one, which the scripted server doesn't take, empties it as clearing does (`pane-drafts.svelte.test.ts`).
 */
test.use(DEVICES.desktop);

test('a draft outlasts a reload, until it is emptied', async ({ preview, page }) => {
	await preview.openRoot();
	await preview.composer().click();
	await page.keyboard.type('Half a thought');
	await page.keyboard.press('Shift+Enter');
	await page.keyboard.type('and its second line');
	await page.reload();
	await expect(page.getByTestId('connection-status')).toHaveText('Connected');
	await expect(preview.composer()).toContainText('Half a thought');
	await expect(preview.composer()).toContainText('and its second line');

	await preview.composer().click();
	await page.keyboard.press('ControlOrMeta+A');
	await page.keyboard.press('Backspace');
	await expect(preview.composer()).toHaveText('');
	await page.reload();
	await expect(page.getByTestId('connection-status')).toHaveText('Connected');
	await expect(preview.composer()).toHaveText('');
	expect(await page.evaluate(() => Object.keys(localStorage).filter((item) => item.startsWith('apron.draft:')))).toEqual([]);
});
