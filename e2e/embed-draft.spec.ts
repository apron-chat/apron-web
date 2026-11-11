import { DEVICES, expect, test } from './fixtures';

/** A draft long enough to write in the full panel. */
const DOC = ['# Rollout plan', '', ...Array.from({ length: 30 }, (_, n) => `${n + 1}. Promote the next slice of hosts.`)].join('\n');

for (const [device, use] of [['desktop', DEVICES.desktop], ['phone', DEVICES.phone]] as const) {
	test.describe(`the full composer, on a ${device}`, () => {
		test.use({ ...use, knobs: { capabilities: ['embed:upload'] } });

		test('embeds the draft as message.md, back in the compact composer to add a caption and send', async ({ preview, page }) => {
			await preview.open();
			await preview.press(preview.composer());
			await page.keyboard.insertText(DOC);
			const embed = page.getByRole('button', { name: 'Embed as attachment' });
			// Not in the compact composer.
			await expect(embed).toHaveCount(0);
			await preview.press(page.getByTestId('composer-expand'));
			await expect(page.getByTestId('composer-panel')).toBeVisible();
			await expect(embed).toBeInViewport();

			await preview.press(embed);
			await expect(page.getByTestId('composer-panel')).toHaveCount(0);
			await expect(page.getByRole('button', { name: 'Rename message.md' })).toBeVisible();
			await expect(preview.composer()).toHaveText('');
			await preview.composer().click();
			await page.keyboard.type('The plan, as a file');
			await preview.press(page.getByRole('button', { name: 'Send message', exact: true }));
			const sent = await preview.waitForSent('message', (p) => p.body?.embeds?.length > 0);
			expect(sent.body.text).toBe('The plan, as a file');
			expect(sent.body.embeds).toEqual([expect.objectContaining({ kind: 'upload', title: 'message.md' })]);
		});
	});
}
