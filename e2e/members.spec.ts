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
	await expect(page.getByTestId('room-member-list').getByRole('status')).toHaveText('Added Grace Hopper.');
});
