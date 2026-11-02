import { NOW } from '../scripts/qa/lib/helpers.js';
import { DEVICES, expect, test } from './fixtures';

/**
 * `seen` (§4.5.2): when someone's shown status last became `offline`. An offline member's profile card says
 * "Last seen …", with the exact time as its tooltip, and their row in the member list says it in its tooltip.
 * Only while they show offline, and never for you. Under ten minutes it says "recently", since a server may record
 * `seen` coarsely; and it is never earlier than when this page saw them go offline.
 */

test.use(DEVICES.desktop);

test('a guest sees when an offline member was last seen, from the listing of a scripted server', async ({ preview, page }) => {
	// `/` against the scripted server: General's Ada is offline, seen two hours before the fixed clock; Bob is online.
	await preview.openRoot();
	const list = await preview.showMembers();
	const ada = list.locator('li[data-user="ada"]');
	await expect(ada).toHaveAttribute('data-status', 'offline');
	await expect(ada.locator('button[data-user-id="ada"]')).toHaveAttribute('title', '@ada · Offline · last seen 2h ago');
	await expect(list.locator('button[data-user-id="bob"]')).toHaveAttribute('title', '@bob · Online');

	await preview.memberProfile(list, 'ada');
	const card = page.getByRole('dialog', { name: 'Profile of Ada' });
	await expect(card.getByTestId('profile-status')).toHaveText('Offline');
	const seen = card.getByTestId('profile-seen');
	await expect(seen).toHaveText('Last seen 2h ago');
	await expect(seen).toHaveAttribute('datetime', '2026-10-22T10:00:00.000Z');
	await expect(seen).toHaveAttribute('title', 'Last seen 2026-10-22 10:00:00');
	await page.keyboard.press('Escape');

	// Bob, online, and you: no last seen.
	for (const [id, name] of [['bob', 'Bob'], ['guest_1', 'Guest 1']]) {
		await preview.memberProfile(list, id);
		const other = page.getByRole('dialog', { name: `Profile of ${name}` });
		await expect(other.getByTestId('profile-status')).toHaveText('Online');
		await expect(other.getByTestId('profile-seen')).toHaveCount(0);
		await page.keyboard.press('Escape');
	}
});

test.describe('live', () => {
	test.use({ knobs: { capabilities: ['status'] } });

	// Ada first: its last check is that Linus, whom the other step changes, still shows the server's seen.
	test('shows last seen only while they show offline, and never earlier than this page watched them leave', async ({ preview, page }) => {
		await preview.open();
		const list = await preview.showMembers();
		const card = page.getByTestId('profile-card');
		const seen = card.getByTestId('profile-seen');

		await test.step('never says someone this page watched leave was seen earlier than that, whatever older seen the server sends', async () => {
			const ada = list.locator('button[data-user-id="ada"]');
			await expect(ada).toHaveAttribute('title', '@ada · Online');
			await preview.memberProfile(list, 'ada');
			// A server that records seen coarsely, or keeps an earlier departure's, sends one from 25 minutes ago.
			await preview.setPresence('ada', 'offline', NOW.getTime() - 25 * 60_000);
			await expect(card.getByTestId('profile-status')).toHaveText('Offline');
			// This page saw it happen now: that is the time shown.
			await expect(seen).toHaveText('Last seen recently');
			await expect(seen).toHaveAttribute('datetime', NOW.toISOString());
			await expect(ada).toHaveAttribute('title', '@ada · Offline · last seen recently');
			// Linus, offline since before this page opened, shows the server's seen alone.
			await expect(list.locator('button[data-user-id="linus"]')).toHaveAttribute('title', '@linus · Offline · last seen 3h ago');
			await page.keyboard.press('Escape');
			await expect(card).toHaveCount(0);
		});

		await test.step('shows last seen only while they show offline: not once they are back, and anew when they go again', async () => {
			const linus = list.locator('button[data-user-id="linus"]');
			await expect(linus).toHaveAttribute('title', '@linus · Offline · last seen 3h ago');
			await preview.memberProfile(list, 'linus');
			await expect(seen).toHaveText('Last seen 3h ago');

			// Back online: the kept seen stays in the client, but says nothing now.
			await preview.setPresence('linus', 'online');
			await expect(card.getByTestId('profile-status')).toHaveText('Online');
			await expect(seen).toHaveCount(0);
			await expect(linus).toHaveAttribute('title', '@linus · Online');

			// Gone again: a new seen, now, which reads as recent, with no exact time to contradict that.
			await preview.setPresence('linus', 'offline');
			await expect(card.getByTestId('profile-status')).toHaveText('Offline');
			await expect(seen).toHaveText('Last seen recently');
			await expect(seen).toHaveAttribute('datetime', NOW.toISOString());
			await expect(seen).toHaveAttribute('title', 'Last seen within the last 10 minutes');
			await expect(linus).toHaveAttribute('title', '@linus · Offline · last seen recently');
		});
	});
});
