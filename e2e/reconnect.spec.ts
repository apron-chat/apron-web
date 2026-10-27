import { DEVICES, expect, test, type Preview } from './fixtures';

/**
 * Coming back from a dropped connection (behavior.md, "A short drop of the connection"): the page stays as it was,
 * says nothing for the way back's first moments, nor while a hidden tab waits, and only your own dot shows it.
 * The tab's visibility is played here, since a test's page is never hidden.
 */

// A guest: the memory server signs in only guests, so a saved account's token would find no way back in.
test.use({ ...DEVICES.desktop, knobs: { capabilities: ['status'] } });

test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		let hidden = false;
		Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
		Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => hidden });
		(window as unknown as { setHidden: (next: boolean) => void }).setHidden = (next) => {
			hidden = next;
			document.dispatchEvent(new Event('visibilitychange'));
		};
	});
});

/** Hides or shows the tab. */
function setHidden(preview: Preview, hidden: boolean): Promise<void> {
	return preview.page.evaluate((next) => (window as unknown as { setHidden: (next: boolean) => void }).setHidden(next), hidden);
}

/** The memory server drops every connection, as a network or a sleeping laptop does. */
function drop(preview: Preview): Promise<void> {
	return preview.page.evaluate(() => {
		const server = (window as unknown as { __apronPreview: { sockets: Set<{ close(): void }> } }).__apronPreview;
		for (const socket of [...server.sockets]) socket.close();
	});
}

/**
 * Holds back the memory server's answers, as a slow network does: a new connection opens and hears the server, but
 * isn't signed in, and so is still reconnecting, until `release`.
 */
function hold(preview: Preview): Promise<void> {
	return preview.page.evaluate(() => {
		type Server = { receive: (socket: unknown, frame: unknown) => void; release?: () => void };
		const server = (window as unknown as { __apronPreview: Server }).__apronPreview;
		const receive = Object.getPrototypeOf(server).receive.bind(server);
		const held: Array<[unknown, unknown]> = [];
		server.receive = (socket, frame) => void held.push([socket, frame]);
		server.release = () => {
			server.receive = receive;
			for (const [socket, frame] of held.splice(0)) receive(socket, frame);
		};
	});
}

function release(preview: Preview): Promise<void> {
	return preview.page.evaluate(() => (window as unknown as { __apronPreview: { release: () => void } }).__apronPreview.release());
}

/** Your own dot in the profile bar, by its status: `online` or `unknown` (the dashed ring). */
function ownDot(preview: Preview, status: string) {
	return preview.page.locator(`.ap-shell-side .ap-presence-${status}`).first();
}

/** Opens the preview signed in with a status, so the profile bar has a dot to show. */
async function openWithStatus(preview: Preview): Promise<void> {
	await preview.open('#room=general');
	await preview.page.evaluate(() => {
		(window as unknown as { __apronPreview: { people: Record<string, { status?: string }> } }).__apronPreview.people.preview_guest.status = 'online';
	});
	// The next sign-in carries it.
	await drop(preview);
	await expect(ownDot(preview, 'online')).toBeVisible();
}

/** What a quiet reconnect must not take away or put up: the session's controls, and any banner or pill. */
async function expectUndisturbed(preview: Preview): Promise<void> {
	const { page } = preview;
	await expect(page.locator('.ap-shell-banner')).toHaveCount(0);
	await expect(page.locator('.ap-tlstatus')).toHaveCount(0);
	await expect(page.locator('.ap-memberlist-sectionhead').first()).toBeVisible();
	await expect(page.getByRole('button', { name: 'Create room' })).toBeVisible();
	await expect(preview.composer()).not.toHaveAttribute('contenteditable', 'false');
	// Nothing said to a screen reader either: neither a stale "Connected" nor "Reconnecting…".
	await expect(page.getByTestId('connection-status')).toHaveText('');
}

test('a connection dropped while the tab is hidden says nothing, there or once it is shown', async ({ preview, page }) => {
	await openWithStatus(preview);
	await hold(preview);
	await setHidden(preview, true);
	await drop(preview);
	// Away, however long: only your own dot says it.
	await expect(ownDot(preview, 'unknown')).toBeVisible();
	await page.waitForTimeout(1_000);
	await expectUndisturbed(preview);

	// Shown again, while the way back is slow: still nothing, for its first moments.
	await setHidden(preview, false);
	await expectUndisturbed(preview);
	// Well inside the quiet moment (1.5 s), leaving room for a slow machine.
	await page.waitForTimeout(500);
	await expectUndisturbed(preview);
	await expect(ownDot(preview, 'unknown')).toBeVisible();
	await release(preview);
	await expect(ownDot(preview, 'online')).toBeVisible();
	await expect(page.getByTestId('connection-status')).toHaveText('Connected');
	await expect(preview.message('Welcome to Apron!')).toBeVisible();
});

test('a short drop while the tab shows keeps the page as it was, and what is typed meanwhile', async ({ preview, page }) => {
	await openWithStatus(preview);
	await preview.composer().click();
	await page.keyboard.type('Back in');
	await hold(preview);
	await drop(preview);
	await expect(ownDot(preview, 'unknown')).toBeVisible();
	await expectUndisturbed(preview);
	// Typing goes on through it; sending waits for the connection.
	await page.keyboard.type(' a bit');
	await expect(page.getByTestId('send-button')).toBeDisabled();
	await page.waitForTimeout(300);
	await expectUndisturbed(preview);
	await release(preview);
	await expect(ownDot(preview, 'online')).toBeVisible();
	await expect(page.getByTestId('send-button')).toBeEnabled();
	await expect(preview.composer()).toHaveText('Back in a bit');
	await expect(page.getByTestId('connection-status')).toHaveText('Connected');
});

test('a way back that takes longer says so after its first moments, then goes quiet again', async ({ preview, page }) => {
	await openWithStatus(preview);
	await hold(preview);
	await drop(preview);
	await expect(page.locator('.ap-tlstatus')).toHaveCount(0);
	await expect(page.locator('.ap-tlstatus-pill')).toContainText('Reconnecting', { timeout: 3_000 });
	await expect(page.locator('.ap-shell-banner')).toHaveCount(0);
	await release(preview);
	await expect(page.locator('.ap-tlstatus')).toHaveCount(0);
	await expect(ownDot(preview, 'online')).toBeVisible();
});
