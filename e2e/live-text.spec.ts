import { DEVICES, expect, test, type Preview } from './fixtures';

/**
 * Live text (§4.8.3): `terminal` embeds drawn by xterm.js (§4.8.6), and `append` embeds whose text continues the
 * body (§4.8.5), against the memory server's live text (`startLive`, `liveWrite`, `liveEnd`, and the
 * `/embed-terminal` and `/embed-append` commands).
 */

const ESC = '\u001b';
const BUILD = `${ESC}[1m$ make test${ESC}[0m\r\n${ESC}[32mok${ESC}[0m  store     0.41s\r\n${ESC}[38;5;208m256${ESC}[0m ${ESC}[38;2;143;176;245mtrue${ESC}[0m\r\n`;

/** The terminal of the message that says `text`, or of the last terminal message. */
const terminalOf = (preview: Preview) => preview.page.getByTestId('terminal-embed').last();

/** What the terminal's screen shows, row by row, as xterm draws it. */
async function screenText(preview: Preview): Promise<string[]> {
	return terminalOf(preview).locator('.xterm-rows > div').allInnerTexts();
}

test.describe('a terminal embed', () => {
	test.use(DEVICES.desktop);

	test('draws live output as a terminal would, read-only, then its output once finished', async ({ preview, page }) => {
		await preview.open();
		const title = await page.title();
		const id = await preview.startLive('general', 'ada', 'terminal', { title: 'make test' });
		const terminal = terminalOf(preview);
		await expect(terminal.locator('.ap-embed-termtitle')).toHaveText('make test');
		await expect(terminal.locator('.ap-embed-livebadge')).toHaveText('Live');
		// A title, the clipboard and the bell do nothing outside the embed.
		await preview.liveWrite(id, `${ESC}]0;pwned\u0007${ESC}]52;c;cHduZWQ=\u0007\u0007${BUILD}`);
		await expect(terminal.locator('.xterm-rows')).toContainText('$ make test');
		await expect.poll(async () => (await screenText(preview)).slice(0, 3).map((row) => row.trimEnd())).toEqual(['$ make test', 'ok  store     0.41s', '256 true']);
		expect(await page.title()).toBe(title);
		// Rows below the last one written are hidden.
		await expect(terminal.locator('.ap-embed-termscreen')).toHaveAttribute('data-rows', '3');
		// A progress bar redrawn with carriage returns keeps one row.
		await preview.liveWrite(id, 'coverage  10%\rcoverage  60%\rcoverage 100%\r\n');
		await expect.poll(async () => (await screenText(preview))[3]?.trimEnd()).toBe('coverage 100%');
		// Nothing can be typed into it, and nothing it does is sent anywhere.
		await terminal.locator('.ap-embed-termscreen').click();
		await page.keyboard.type('rm -rf /\n');
		await expect.poll(async () => (await screenText(preview)).join('\n')).not.toContain('rm -rf');
		const font = Number(await terminal.locator('.ap-embed-termscreen').getAttribute('data-font-size'));
		expect(font).toBeGreaterThan(10);
		expect(font).toBeLessThanOrEqual(13);
		await preview.liveEnd(id);
		await expect(terminal.locator('.ap-embed-detail')).toHaveText('Finished');
		await expect.poll(async () => (await screenText(preview))[0]?.trimEnd()).toBe('$ make test');
	});

	test('the full-screen alternate screen shows all 40 rows', async ({ preview }) => {
		await preview.open();
		const id = await preview.startLive('general', 'ada', 'terminal');
		await preview.liveWrite(id, `${ESC}[?1049h${ESC}[H top of a full-screen program`);
		await expect(terminalOf(preview).locator('.ap-embed-termscreen')).toHaveAttribute('data-rows', '40');
		await preview.liveWrite(id, `${ESC}[?1049l`);
		await expect(terminalOf(preview).locator('.ap-embed-termscreen')).toHaveAttribute('data-rows', '1');
	});

	test('/embed-terminal answers with a recipe, then plays the preview’s demo', async ({ preview, page }) => {
		await preview.open();
		await preview.composer().click();
		await page.keyboard.insertText('/embed-terminal demo build');
		await page.keyboard.press('Enter');
		await expect(page.getByText('stty cols 80 rows 40', { exact: false })).toBeVisible();
		const terminal = terminalOf(preview);
		await expect(terminal.locator('.ap-embed-termtitle')).toHaveText('demo build');
		await expect(terminal.locator('.ap-embed-detail')).toHaveText('Finished', { timeout: 15_000 });
		await expect(terminal.locator('.xterm-rows')).toContainText('PASS 3 packages');
	});
});

test.describe('a terminal embed on a phone', () => {
	test.use(DEVICES.phone360);

	test('fits its 80 columns without scrolling the page sideways', async ({ preview, page }) => {
		await preview.open();
		const id = await preview.startLive('general', 'ada', 'terminal', { title: 'make test' });
		await preview.liveWrite(id, `${'0123456789'.repeat(8)}\r\n${BUILD}`);
		const screen = terminalOf(preview).locator('.ap-embed-termscreen');
		await expect(terminalOf(preview).locator('.xterm-rows')).toContainText('$ make test');
		const fit = await screen.evaluate((box) => ({ box: box.clientWidth, drawn: box.querySelector('.xterm-screen')!.getBoundingClientRect().width }));
		expect(fit.drawn).toBeLessThanOrEqual(fit.box);
		expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth)).toBeLessThanOrEqual(0);
		expect(Number(await screen.getAttribute('data-font-size'))).toBeGreaterThanOrEqual(4);
	});
});

test.describe('an append embed', () => {
	test.use(DEVICES.desktop);

	test('grows the body in place, rendered as one Markdown text, with Writing… until it ends, and no card', async ({ preview }) => {
		await preview.open();
		const id = await preview.startLive('general', 'grace', 'append', { body: { text: 'Here is the plan:\n\n' } });
		const message = preview.message('Here is the plan:');
		await expect(message.getByTestId('message-writing')).toHaveText('Writing…');
		await preview.liveWrite(id, '1. **Roll back** the ind');
		await expect(message.locator('.ap-msg-text li strong')).toHaveText('Roll back');
		await preview.liveWrite(id, 'ex\n2. Renew **the c');
		// A ** still open is closed for now, so it reads as bold already rather than as stars.
		await expect(message.locator('.ap-msg-text li').nth(1).locator('strong')).toHaveText('the c');
		await expect(message.locator('.ap-msg-text')).not.toContainText('**');
		await expect(message.locator('.ap-embed-slot')).toHaveCount(0);
		await preview.liveWrite(id, 'ert**\n');
		await preview.liveEnd(id);
		await expect(message.getByTestId('message-writing')).toHaveCount(0);
		await expect(message.locator('.ap-msg-text li')).toHaveText(['Roll back the index', 'Renew the cert']);
	});

	test('an edit while it streams starts from the message as recorded, and keeps the embed', async ({ preview, page }) => {
		await preview.open();
		const id = await preview.startLive('general', 'preview_guest', 'append', { body: { text: 'Plan:' } });
		await preview.liveWrite(id, ' streamed so far');
		const message = preview.message('Plan: streamed so far');
		await expect(message).toBeVisible();
		await message.hover();
		await message.getByRole('button', { name: 'Edit message', exact: true }).click();
		const editor = page.getByRole('textbox', { name: 'Edit message', exact: true });
		await expect(editor).toHaveValue('Plan:');
		await editor.fill('The plan:');
		await page.keyboard.press('Enter');
		const saved = await preview.waitForSent('message', (params) => params.message_id !== undefined);
		expect(saved.body).toMatchObject({ text: 'The plan:', embeds: [{ embed_id: id, kind: 'append' }] });
		await preview.liveWrite(id, ' and more');
		await expect(preview.message('The plan: streamed so far and more')).toBeVisible();
	});
});
