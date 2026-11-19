import { DEVICES, expect, test } from './fixtures';

const OUT = '/tmp/claude-0/-home-user-apron-web/dcd2b386-8b1b-5b3b-a873-aa4412dddabf/scratchpad';

test.describe('review desktop', () => {
	test.use(DEVICES.desktop);

	test('keyboard focus after Enter', async ({ preview, page }) => {
		await preview.open();
		await preview.post('general', 'ada', 'Key ||hidden one|| text');
		const row = preview.message('Key');
		const spoiler = row.locator('.ap-spoiler');
		await spoiler.focus();
		await page.keyboard.press('Enter');
		await page.waitForTimeout(300);
		console.log('ACTIVE after Enter:', await page.evaluate(() => `${document.activeElement?.tagName}.${document.activeElement?.className}`));
		await page.keyboard.press('ArrowRight');
		console.log('ACTIVE after ArrowRight:', await page.evaluate(() => `${document.activeElement?.tagName}.${document.activeElement?.className}`));
	});

	test('select mode click on spoiler', async ({ preview, page }) => {
		await preview.open();
		await preview.post('general', 'ada', 'Sel ||hidden two|| text');
		const row = preview.message('Sel');
		await preview.post('general', 'ada', 'Other plain message');
		const other = preview.message('Other plain');
		await other.locator('.ap-msg-text').click({ modifiers: ['Shift'], position: { x: 2, y: 2 } });
		console.log('other selected after shift-click:', await other.getAttribute('class'));
		await row.locator('.ap-spoiler').click();
		console.log('after spoiler click:', await row.getAttribute('class'), await row.locator('.ap-spoiler').getAttribute('class'));
	});

	test('thread card / header tooltip / sidebar', async ({ preview, page }) => {
		await preview.open();
		await preview.post('thread_cert', 'linus', 'Latest ||SECRET-LATEST|| news');
		await preview.describe('general', 'Topic ||SECRET-TOPIC|| here');
		await page.waitForTimeout(500);
		await page.getByRole('button', { name: 'Hide description' }).first().click();
		await page.waitForTimeout(200);
		const hd = page.getByTestId('room-description');
		console.log('header topic count', await hd.count(), await hd.count() ? await hd.first().evaluate((e) => e.textContent + ' | title=' + e.getAttribute('title')) : '');
		console.log('thread lines', await page.evaluate(() => [...document.querySelectorAll('*')].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent?.includes('SECRET-LATEST'))).map((e) => e.className + ' [in spoiler: ' + Boolean(e.closest('.ap-spoiler')) + ']: ' + e.textContent)));
		const body = await page.evaluate(() => document.body.innerText);
		console.log('innerText has SECRET-LATEST:', body.includes('SECRET-LATEST'), 'SECRET-TOPIC:', body.includes('SECRET-TOPIC'));
		const titles = await page.evaluate(() => [...document.querySelectorAll('[title]')].map((e) => e.getAttribute('title')).filter((t) => t?.includes('SECRET')));
		console.log('titles with SECRET:', JSON.stringify(titles));
		await page.screenshot({ path: `${OUT}/threads.png` });
	});

	test('rendering: emoji, wrap, dark, forced colors, selection', async ({ preview, page }) => {
		await preview.open();
		await preview.post('general', 'ada', 'Emj ||😀🎉 plain text emoji :) and `code` and @margaret and ~~struck~~ and a long tail that keeps going on and on so that the spoiler wraps across lines in the timeline row for sure yes indeed more words here and more|| end');
		await preview.post('general', 'ada', 'Strike ~~over ||hidden three|| text~~ and [link ||hidden four|| x](https://example.com)');
		const row = preview.message('Emj');
		await row.scrollIntoViewIfNeeded();
		await row.screenshot({ path: `${OUT}/light.png` });
		await preview.message('Strike over').screenshot({ path: `${OUT}/strike.png` });
		await page.emulateMedia({ colorScheme: 'dark' });
		await row.screenshot({ path: `${OUT}/dark.png` });
		await page.emulateMedia({ colorScheme: 'light', forcedColors: 'active' });
		await row.screenshot({ path: `${OUT}/forced.png` });
		await row.locator('.ap-spoiler').focus();
		await row.screenshot({ path: `${OUT}/forced-focus.png` });
		await page.emulateMedia({ forcedColors: 'none' });
		await row.locator('.ap-spoiler').focus();
		await row.screenshot({ path: `${OUT}/focus.png` });
		const sel = await row.locator('.ap-msg-text').evaluate((el) => {
			const range = document.createRange();
			range.selectNodeContents(el);
			getSelection()!.removeAllRanges();
			getSelection()!.addRange(range);
			return getSelection()!.toString();
		});
		console.log('selection text:', sel.slice(0, 60));
		await row.screenshot({ path: `${OUT}/selected.png` });
		// a11y tree
		const snap = await row.locator('.ap-msg-text').ariaSnapshot();
		console.log('aria:', snap);
	});

	test('click on spoiler inside a link', async ({ preview, page }) => {
		await preview.open();
		await preview.post('general', 'ada', 'Lnk [see ||hidden five|| x](https://example.com/z)');
		const row = preview.message('Lnk');
		const pages = page.context().pages().length;
		await row.locator('.ap-spoiler').click();
		console.log('pages after reveal click', page.context().pages().length - pages, await row.locator('.ap-spoiler').getAttribute('class'));
	});
});

test.describe('review phone', () => {
	test.use(DEVICES.phone);

	test('long press on spoiler', async ({ preview, page }) => {
		await preview.open();
		await preview.post('general', 'ada', 'Hold ||hidden six that is long enough to hold|| text');
		const row = preview.message('Hold');
		await row.scrollIntoViewIfNeeded();
		const box = (await row.locator('.ap-spoiler').boundingBox())!;
		const point = { x: box.x + 10, y: box.y + box.height / 2 };
		const cdp = await page.context().newCDPSession(page);
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
		await page.waitForTimeout(700);
		console.log('menu visible before lift:', await row.getByRole('toolbar', { name: 'Message actions' }).isVisible(), await page.evaluate(() => document.activeElement?.className));
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		await page.waitForTimeout(300);
		console.log('active after lift', await page.evaluate(() => document.activeElement?.className));
		console.log('menu visible:', await row.getByRole('toolbar', { name: 'Message actions' }).isVisible());
		console.log('spoiler class after hold:', await row.locator('.ap-spoiler').getAttribute('class'));
	});
});
