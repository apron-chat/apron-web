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

test.describe('a terminal embed, expanded', () => {
	test.use(DEVICES.desktop);

	test('opens full screen from Expand, larger, live from the same read of the text, and closes on Escape and Back', async ({ preview, page }) => {
		await preview.open();
		const heading = await preview.heading().textContent();
		const id = await preview.startLive('general', 'ada', 'terminal', { title: 'make test' });
		const terminal = terminalOf(preview);
		await preview.liveWrite(id, BUILD);
		await expect(terminal.locator('.xterm-rows')).toContainText('$ make test');
		const expand = terminal.getByRole('button', { name: 'Expand terminal' });
		await expand.click();
		const viewer = page.getByRole('dialog', { name: 'make test' });
		await expect(viewer).toBeVisible();
		await expect(viewer.locator('.ap-embed-livebadge')).toHaveText('Live');
		await expect(viewer.getByRole('button', { name: 'Close' })).toBeFocused();
		const screen = viewer.locator('.ap-termviewer-screen');
		await expect(screen.locator('.xterm-rows')).toContainText('ok  store');
		// Larger than in the message, and the whole 80 by 40 screen fits the viewer.
		await expect(screen).toHaveAttribute('data-font-size', /./);
		const inline = Number(await terminal.locator('.ap-embed-termscreen').getAttribute('data-font-size'));
		const full = Number(await screen.getAttribute('data-font-size'));
		expect(full).toBeGreaterThan(inline);
		const fit = await viewer.locator('.ap-termviewer-stage').evaluate((stage) => {
			const drawn = stage.querySelector('.xterm-screen')!.getBoundingClientRect();
			return { width: drawn.width <= stage.clientWidth, height: drawn.height <= stage.clientHeight, scrolls: stage.scrollWidth > stage.clientWidth };
		});
		expect(fit).toEqual({ width: true, height: true, scrolls: false });
		// What arrives reaches the viewer too, from the one GET the embed made.
		await preview.liveWrite(id, 'coverage 100%\r\n');
		await expect(screen.locator('.xterm-rows')).toContainText('coverage 100%');
		await expect(terminal.locator('.xterm-rows')).toContainText('coverage 100%');
		expect(await preview.liveReads(id)).toBe(1);

		await page.keyboard.press('Escape');
		await expect(viewer).toBeHidden();
		await expect(expand).toBeFocused();
		await expect(preview.heading()).toHaveText(heading!);

		// Back closes it too, leaving the room as it was.
		await expand.click();
		await expect(viewer).toBeVisible();
		await page.goBack();
		await expect(viewer).toBeHidden();
		await expect(preview.heading()).toHaveText(heading!);
		await expect(terminal).toBeVisible();

		// Finished while open: the viewer shows the output, as Finished.
		await expand.click();
		await preview.liveEnd(id);
		await expect(viewer.locator('.ap-viewer-detail')).toHaveText('Finished');
		await expect(screen.locator('.xterm-rows')).toContainText('coverage 100%');
		expect(await preview.liveReads(id)).toBe(1);
	});
});

test.describe('a terminal embed, expanded on a phone', () => {
	test.use(DEVICES.phone);

	test('opens on a tap on its screen, at a readable size that scrolls sideways inside the viewer, never the page', async ({ preview, page }) => {
		await preview.open();
		const id = await preview.startLive('general', 'ada', 'terminal', { title: 'make test' });
		const terminal = terminalOf(preview);
		await preview.liveWrite(id, `${'0123456789'.repeat(8)}\r\n${BUILD}`);
		await expect(terminal.locator('.xterm-rows')).toContainText('$ make test');
		await terminal.locator('.ap-embed-termscreen').tap();
		const viewer = page.getByRole('dialog', { name: 'make test' });
		await expect(viewer).toBeVisible();
		const screen = viewer.locator('.ap-termviewer-screen');
		await expect(screen.locator('.xterm-rows')).toContainText('0123456789');
		await expect(screen).toHaveAttribute('data-font-size', '9');
		const stage = await viewer.locator('.ap-termviewer-stage').evaluate((box) => ({ scrolls: box.scrollWidth > box.clientWidth }));
		expect(stage.scrolls).toBe(true);
		expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth)).toBeLessThanOrEqual(0);
		await viewer.getByRole('button', { name: 'Close' }).tap();
		await expect(viewer).toBeHidden();
		expect(await preview.liveReads(id)).toBe(1);
	});

	test('on its side, fits the 80 columns at a size larger than the message’s, without scrolling sideways', async ({ preview, page }) => {
		await page.setViewportSize({ width: 844, height: 390 });
		await preview.open();
		const id = await preview.startLive('general', 'ada', 'terminal', { title: 'make test' });
		const terminal = terminalOf(preview);
		await preview.liveWrite(id, BUILD);
		await expect(terminal.locator('.xterm-rows')).toContainText('$ make test');
		await terminal.getByRole('button', { name: 'Expand terminal' }).tap();
		const screen = page.getByRole('dialog', { name: 'make test' }).locator('.ap-termviewer-screen');
		await expect(screen.locator('.xterm-rows')).toContainText('ok  store');
		const inline = Number(await terminal.locator('.ap-embed-termscreen').getAttribute('data-font-size'));
		await expect(screen).toHaveAttribute('data-font-size', '13');
		expect(inline).toBeLessThan(13);
		const scrolls = await page.locator('.ap-termviewer-stage').evaluate((box) => box.scrollWidth > box.clientWidth);
		expect(scrolls).toBe(false);
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
		await expect(editor).toBeFocused();
		await expect(editor).toHaveText('Plan:');
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.type('The plan:');
		await page.keyboard.press('Enter');
		const saved = await preview.waitForSent('message', (params) => params.message_id !== undefined);
		expect(saved.body).toMatchObject({ text: 'The plan:', embeds: [{ embed_id: id, kind: 'append' }] });
		await preview.liveWrite(id, ' and more');
		await expect(preview.message('The plan: streamed so far and more')).toBeVisible();
	});
});
