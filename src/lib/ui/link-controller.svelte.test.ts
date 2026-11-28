import { describe, expect, it, vi } from 'vitest';
import type { ClientSnapshot } from '$lib/protocol/client';
import type { Proposal } from '$lib/protocol/proposals';
import { SignInLinks, type LinkClient } from './link-controller.svelte';
import { askedLinkFailure } from './sign-in-link';
import * as signInPage from './sign-in-page';
import type { PendingAuthorization } from './sign-in-page';

const HERE = 'wss://here.example/';
const THERE = 'wss://there.example/';

const proposals: Record<string, Proposal> = {
	mail: { scheme: 'email', kind: 'sign-in', url: THERE, state: 'mail', expires: Infinity },
	here: { scheme: 'email', kind: 'sign-in', url: HERE, state: 'here', expires: Infinity },
	add: { scheme: 'email', kind: 'addition', url: HERE, state: 'add', account: 'ada', expires: Infinity }
};

/** A deferred answer from the client, so a test can look while a link is in flight. */
function deferred() {
	let settle!: { resolve: (value?: unknown) => void; reject: (cause: unknown) => void };
	const promise = new Promise<unknown>((resolve, reject) => (settle = { resolve, reject }));
	return { promise, ...settle };
}

/** The controller on a page whose client is on `HERE`, with what it told the page. */
function page() {
	const answer = { signIn: deferred(), add: deferred() };
	const chat = {
		url: HERE,
		signInWithLink: vi.fn((_token: string, _url: string, options: { beforeSwitch?: () => void }) => answer.signIn.promise.then(() => options.beforeSwitch?.())),
		addWithConfirmedLink: vi.fn(() => answer.add.promise),
		addWithLink: vi.fn(() => answer.add.promise),
		signInWithExternalCode: vi.fn((_redeem: unknown, _url: string, options: { beforeSwitch?: () => void }) => answer.signIn.promise.then(() => options.beforeSwitch?.())),
		addExternalWithCode: vi.fn(async () => answer.add.promise.then(() => undefined)),
		finishPasskeyWithCode: vi.fn(() => answer.add.promise)
	} satisfies LinkClient;
	const said: string[] = [];
	const host = {
		client: (): LinkClient | undefined => chat,
		feedback: { pending: (text: string) => said.push(`… ${text}`), clear: () => said.push('clear'), error: (text: string) => said.push(`! ${text}`) },
		findProposal: (state: string | undefined) => (state ? proposals[state] : undefined),
		beforeSwitch: vi.fn(),
		signedIn: vi.fn(),
		failed: vi.fn()
	};
	return { links: new SignInLinks(host), chat, host, said, answer };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a sign-in link this browser proposed', () => {
	it('signs in at once on the server it was proposed to, and only then remembers the switch', async () => {
		const { links, chat, host, said, answer } = page();
		links.follow({ token: 'tok', state: 'mail', server: THERE });
		expect(chat.signInWithLink).toHaveBeenCalledWith('tok', THERE, expect.objectContaining({ scheme: 'email', state: 'mail' }));
		expect([links.busy, links.asked, said]).toEqual([true, undefined, ['… Signing in…']]);
		expect(host.signedIn).not.toHaveBeenCalled();
		answer.signIn.resolve();
		await settled();
		expect(host.beforeSwitch).toHaveBeenCalledWith(true);
		expect(host.signedIn).toHaveBeenCalledWith(THERE, true);
		expect(host.failed).not.toHaveBeenCalled();
		expect([links.busy, links.failure, said]).toEqual([false, undefined, ['… Signing in…', 'clear']]);
		// One proposed to the server this page is on switches nothing.
		links.follow({ token: 'tok2', state: 'here', server: HERE });
		await settled();
		expect(host.beforeSwitch).toHaveBeenLastCalledWith(false);
		expect(host.signedIn).toHaveBeenLastCalledWith(HERE, false);
	});

	it('changes nothing when refused, and opens the connect screen on its server and scheme, saying how to start again for that scheme', async () => {
		const { links, host, answer } = page();
		links.follow({ token: 'tok', state: 'mail', server: THERE });
		answer.signIn.reject(new Error('expired'));
		await settled();
		const error = 'The sign-in link didn’t work (expired). Send a new code to try again, or pick another server.';
		expect(host.failed).toHaveBeenCalledWith({ error, server: THERE, scheme: 'email' });
		expect([host.signedIn.mock.calls, host.beforeSwitch.mock.calls, links.failure, links.busy]).toEqual([[], [], { error }, false]);
	});

	it('is dropped, saying so, when it names another server than the one proposed to, or none, and never asked about', async () => {
		const { links, chat, host, said } = page();
		links.follow({ token: 'tok', state: 'mail', server: HERE });
		links.follow({ token: 'tok', state: 'mail' });
		links.follow({ token: 'tok', state: 'add', server: THERE });
		await settled();
		expect([chat.signInWithLink.mock.calls, chat.addWithLink.mock.calls, host.beforeSwitch.mock.calls, host.failed.mock.calls]).toEqual([[], [], [], []]);
		expect([links.asked, links.addition, links.busy, links.failure]).toEqual([undefined, undefined, false, undefined]);
		expect(said).toEqual([
			'! That sign-in link is for another server, not there.example, where you asked for it, so it wasn’t used.',
			'! That sign-in link doesn’t say it’s for there.example, where you asked for it, so it wasn’t used.',
			'! That sign-in link is for another server, not here.example, where you asked for it, so it wasn’t used.'
		]);
	});
});

describe('a sign-in link of no proposal here', () => {
	it('is never used before the viewer confirms it, and dropped when the server it names isn’t one', async () => {
		const { links, chat, host } = page();
		const link = { token: 'tok', server: THERE };
		links.follow(link);
		expect(links.asked).toEqual(link);
		expect(chat.signInWithLink).not.toHaveBeenCalled();
		links.cancel();
		expect(links.asked).toBeUndefined();
		await settled();
		expect([chat.signInWithLink.mock.calls, host.beforeSwitch.mock.calls]).toEqual([[], []]);
		// One naming a server that isn't one is dropped without asking.
		links.follow({ token: 'tok', server: undefined, badServer: true });
		expect([links.asked, links.busy, chat.signInWithLink.mock.calls]).toEqual([undefined, false, []]);
	});

	it('signs in on the server it names once confirmed, with no proposal’s scheme or state', async () => {
		const { links, chat, host, answer } = page();
		links.follow({ token: 'tok', server: THERE });
		links.confirm();
		expect(links.asked).toBeUndefined();
		expect(chat.signInWithLink).toHaveBeenCalledWith('tok', THERE, { beforeSwitch: expect.any(Function) });
		answer.signIn.reject(new Error('nope'));
		await settled();
		expect(host.failed).toHaveBeenCalledWith({ error: askedLinkFailure('nope'), server: THERE });
	});

	it('adds to this account when the viewer says it was sent for that, saying when it is refused', async () => {
		const { links, chat, said, answer } = page();
		links.follow({ token: 'tok' });
		links.addAsked();
		expect(chat.addWithConfirmedLink).toHaveBeenCalledWith('tok');
		expect([links.asked, links.busy]).toEqual([undefined, true]);
		answer.add.reject(Object.assign(new Error('refused'), { code: -32001 }));
		await settled();
		expect(links.busy).toBe(false);
		expect(said.at(-1)).toMatch(/^! That link was refused/);
		expect(chat.signInWithLink).not.toHaveBeenCalled();
	});
});

describe('a link for an addition this browser proposed', () => {
	const snapshot = (fields: Partial<ClientSnapshot>) => ({ status: 'connected', authenticated: true, you: { user_id: 'ada' }, ...fields }) as ClientSnapshot;

	it('waits for the session to settle, then adds on the account that proposed it', () => {
		const { links, chat, said } = page();
		links.follow({ token: 'tok', state: 'add', server: HERE });
		expect(links.addition).toMatchObject({ account: 'ada', server: HERE });
		links.settle(snapshot({ status: 'connecting' }));
		links.settle(snapshot({ authBusy: true }));
		expect(chat.addWithLink).not.toHaveBeenCalled();
		links.settle(snapshot({}));
		expect(chat.addWithLink).toHaveBeenCalledWith('tok', 'add');
		expect([links.addition, links.busy, said]).toEqual([undefined, true, ['… Adding the sign-in…']]);
	});

	it('says it can’t, and adds nothing, when the page is signed in as someone else', () => {
		const { links, chat, said } = page();
		links.follow({ token: 'tok', state: 'add', server: HERE });
		links.settle(snapshot({ you: { user_id: 'bob' } }));
		expect(chat.addWithLink).not.toHaveBeenCalled();
		expect(said).toEqual(['! The link adds a sign-in to @ada on here.example, which this page isn’t signed in as now. Sign in as @ada there, and add it again.']);
		expect(links.addition).toBeUndefined();
	});
});

describe('one link at a time', () => {
	it('uses no second link while one signs in, so the first is never marked done by another', async () => {
		const { links, chat, answer } = page();
		links.follow({ token: 'tok', state: 'mail', server: THERE });
		links.follow({ token: 'tok2', state: 'here', server: HERE });
		expect(chat.signInWithLink).toHaveBeenCalledOnce();
		expect(links.working).toBe('signing-in');
		answer.signIn.resolve();
		await settled();
		expect(links.busy).toBe(false);
	});

	it('keeps an addition waiting until the link under way is done', async () => {
		const { links, chat, answer } = page();
		const snapshot = { status: 'connected', authBusy: false, authenticated: true, you: { user_id: 'ada' }, server: { apron: 11, auth: ['email'], capabilities: [] } } as unknown as ClientSnapshot;
		links.follow({ token: 'tok', state: 'mail', server: THERE });
		links.follow({ token: 'add-tok', state: 'add', server: HERE });
		links.settle(snapshot);
		expect(chat.addWithLink).not.toHaveBeenCalled();
		expect(links.addition).toBeDefined();
		answer.signIn.resolve();
		await settled();
		links.settle(snapshot);
		expect(chat.addWithLink).toHaveBeenCalledWith('add-tok', 'add');
		expect(links.working).toBe('adding');
	});
});

/** A server's sign-in page that sent this tab back (§4.12, the passkey page): its code, redeemed as its request was for. */
describe('a sign-in page’s answer brought back to this tab', () => {
	const snapshot = { status: 'connected', authBusy: false, authenticated: true, you: { user_id: 'ada' }, server: { apron: 11, auth: ['external', 'webauthn'], capabilities: [] } } as unknown as ClientSnapshot;
	const request = (purpose: PendingAuthorization['purpose'], server = THERE): PendingAuthorization => ({
		state: 'q8Rz', codeVerifier: 'v', redirectUri: 'https://web.example/signed-in/', clientId: 'apron-web', server, purpose, mode: 'page', expires: Infinity
	});
	const redeem = { code: 'Hk41x9', code_verifier: 'v', redirect_uri: 'https://web.example/signed-in/', client_id: 'apron-web' };

	it('signs in with an external code at once, on its server, and only then remembers the switch', async () => {
		const { links, chat, host, said, answer } = page();
		links.followReturn({ pending: { ...request({ scheme: 'external', kind: 'sign-in' }), name: 'Ada' }, response: { code: 'Hk41x9', state: 'q8Rz' } }, signInPage);
		expect(chat.signInWithExternalCode).toHaveBeenCalledWith(redeem, THERE, { name: 'Ada', beforeSwitch: expect.any(Function) });
		expect([links.working, said]).toEqual(['signing-in', ['… Signing in…']]);
		answer.signIn.resolve();
		await settled();
		expect(host.beforeSwitch).toHaveBeenCalledWith(true);
		expect(host.signedIn).toHaveBeenCalledWith(THERE, true);
	});

	it('opens the connect screen on its scheme and server for a declined or refused sign-in', async () => {
		const { links, chat, host, answer } = page();
		links.followReturn({ pending: request({ scheme: 'external', kind: 'sign-in' }), response: { error: 'access_denied', state: 'q8Rz' } }, signInPage);
		expect(chat.signInWithExternalCode).not.toHaveBeenCalled();
		expect(host.failed).toHaveBeenCalledWith({ error: 'Sign-in was cancelled.', server: THERE, scheme: 'external' });
		expect(links.failure).toEqual({ error: 'Sign-in was cancelled.' });
		links.followReturn({ pending: request({ scheme: 'webauthn', action: 'login' }, HERE), response: { code: 'Hk41x9', state: 'q8Rz' } }, signInPage);
		links.settle(snapshot);
		answer.add.reject(new Error('Invalid code'));
		await settled();
		expect(host.failed).toHaveBeenLastCalledWith({ error: 'Invalid code', server: HERE, scheme: 'webauthn' });
	});

	it('finishes a passkey from the passkey page once the page’s session has settled, signing it in', async () => {
		const { links, chat, host, answer } = page();
		links.followReturn({ pending: { ...request({ scheme: 'webauthn', action: 'login' }, HERE), name: 'Ada' }, response: { code: 'Hk41x9', state: 'q8Rz', iss: 'https://here.example' } }, signInPage);
		expect(links.returned).toBeDefined();
		links.settle({ ...snapshot, status: 'connecting' });
		expect(chat.finishPasskeyWithCode).not.toHaveBeenCalled();
		links.settle(snapshot);
		expect(chat.finishPasskeyWithCode).toHaveBeenCalledWith('login', redeem, { server: HERE, name: 'Ada' });
		expect(links.returned).toBeUndefined();
		answer.add.resolve();
		await settled();
		expect(host.signedIn).toHaveBeenCalledWith(HERE, false);
	});

	it('adds an external sign-in on the account it began on, and says so as a toast when refused', async () => {
		const { links, chat, host, said, answer } = page();
		links.followReturn({ pending: request({ scheme: 'external', kind: 'addition', account: 'ada' }, HERE), response: { code: 'Hk41x9', state: 'q8Rz' } }, signInPage);
		links.settle(snapshot);
		expect(chat.addExternalWithCode).toHaveBeenCalledWith(redeem, 'ada');
		answer.add.reject(Object.assign(new Error('denied'), { code: -32001 }));
		await settled();
		expect(said.at(-1)).toMatch(/^! That sign-in was refused/);
		expect(host.failed).not.toHaveBeenCalled();
		expect(host.signedIn).not.toHaveBeenCalled();
	});
});
