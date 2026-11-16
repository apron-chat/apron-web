import { untrack } from 'svelte';
import type { ClientSnapshot } from '$lib/protocol/client';
import type { Proposal, ProposalScheme } from '$lib/protocol/proposals';
import { addError, serverLabel } from './connection';
import { askedLinkFailure, linkUse, runSignInLink, sessionSettled, type LinkUse, type SignInLink, type SignInLinkClient } from './sign-in-link';
import type { AuthorizationFinisher, PendingAuthorization } from './sign-in-page';
import { signInPageError } from './sign-in-window';
import type { AuthorizationResponse, CodeRedemption } from '$lib/protocol/authorization';
import { Task } from './task.svelte';

/**
 * The page's sign-in links (§4.11.2), emailed, from the moment one is taken
 * from the URL to the sign-in or addition it makes; and a server's sign-in
 * page that sent the viewer back to this tab (§4.12, `takeReturned`), from
 * then to the code's redemption. The decisions are `sign-in-link.ts`'s and
 * `sign-in-page.ts`'s; this is their wiring.
 */

/** What the controller needs of the chat client. */
export interface LinkClient extends SignInLinkClient, AuthorizationFinisher {
	addWithConfirmedLink(token: string): Promise<unknown>;
	addWithLink(token: string, state: string): Promise<unknown>;
}

/** What the controller says while it works, as the page's toasts do. */
export interface LinkFeedback {
	pending(text: string): void;
	clear(): void;
	error(text: string): void;
}

/** How the page takes part. */
export interface LinkHost {
	/** The page's client, once there is one. */
	client(): LinkClient | undefined;
	feedback: LinkFeedback;
	/** The proposal this browser made with this `state` (`findProposal`). */
	findProposal(state: string | undefined): Proposal | undefined;
	/** Just before a link signs in as another account: the view held for the current one goes (`switched`: on the link's server). */
	beforeSwitch(switched: boolean): void;
	/** Signed in with the link on `server`: only now is a switch to it (`switched`) remembered. */
	signedIn(server: string, switched: boolean): void;
	/** The link didn't sign in: the connect screen opens on its server, with `error`, and `scheme` (a proposal's own) to start again. */
	failed(failure: { error: string; server: string; scheme?: ProposalScheme | 'external' | 'webauthn' }): void;
}

/** A sign-in page's answer that came back to this tab, waiting for the page's session where it needs that. */
interface Returned {
	pending: PendingAuthorization;
	redeem: CodeRedemption;
}

/** What finishing one needs of `sign-in-page.ts`, which loads on demand: the page has it once it took the answer. */
export type SignInPageModule = Pick<typeof import('./sign-in-page'), 'finishAuthorization' | 'redemption'>;

/** An addition this browser proposed, waiting for the session of the account that proposed it. */
type Addition = Extract<LinkUse, { kind: 'addition' }>;

export class SignInLinks {
	/** A link of no proposal this browser made, until the viewer answers whether to use it. */
	asked = $state<SignInLink | undefined>();
	/**
	 * What a link is being used for, one at a time (`working`): signing in (its token goes out as a fresh
	 * connection's first `auth`) or adding to this account. Another link meanwhile waits, or is dropped, rather
	 * than run beside it. What comes of each shows as the page's toasts, not as a note here.
	 */
	readonly #task = new Task<'signing-in' | 'adding', never>();
	/** A link for an addition this browser proposed (§4.11.3), waiting for the session of the account that proposed it. */
	addition = $state<Addition | undefined>();
	/** Why a link didn't sign in, for the connect screen. */
	failure = $state<{ error: string } | undefined>();
	/**
	 * A sign-in page's answer that came back to this tab for an addition or a passkey, which finish on the page's
	 * own connection: waiting for its session to settle (`settle`).
	 */
	returned = $state.raw<Returned | undefined>();

	constructor(private readonly host: LinkHost) {}

	/** What a link is being used for now, if anything. */
	get working(): 'signing-in' | 'adding' | undefined {
		return this.#task.running;
	}

	/** A link is being used (`working`). */
	get busy(): boolean {
		return this.#task.busy;
	}

	/** Runs `work` as `kind`, unless a link is already being used: then nothing runs. */
	#work(kind: 'signing-in' | 'adding', work: () => Promise<unknown>): void {
		void this.#task.run(kind, work, { failed: () => undefined });
	}

	/**
	 * A link taken from the URL. One with the `state` of a sign-in this
	 * browser proposed is used at once, on the server it was proposed to; one
	 * for an addition waits for the session of the account that proposed it;
	 * either is dropped, saying so, when it names another server than that one
	 * (§4.11.2). Any other is a credential someone else may have crafted or
	 * forwarded, and the viewer is asked first. One that can't be used is
	 * dropped.
	 */
	follow(link: SignInLink): void {
		const use = linkUse(link, (state) => this.host.findProposal(state));
		if (!use) return;
		if (use.kind === 'elsewhere') {
			const asked = serverLabel(use.server) || use.server;
			this.host.feedback.error(link.server || link.badServer
				? `That sign-in link is for another server, not ${asked}, where you asked for it, so it wasn’t used.`
				: `That sign-in link doesn’t say it’s for ${asked}, where you asked for it, so it wasn’t used.`);
			return;
		}
		if (use.kind === 'addition') this.addition = use;
		else if (use.kind === 'own') this.use(use);
		else this.asked = use.link;
	}

	/**
	 * A sign-in page's answer that came back to this tab (`takeReturned`).
	 * Only one with this tab's own `state` gets here. An external sign-in
	 * redeems at once, on a connection of its own; an addition, or a passkey
	 * from the server's passkey page, waits for the page's session, whose
	 * connection takes the code. A decline or an error says so: on the
	 * connect screen for a sign-in, as a toast for an addition.
	 */
	followReturn(returned: { pending: PendingAuthorization; response: AuthorizationResponse }, page: SignInPageModule): void {
		const { pending } = returned;
		const signsIn = pending.purpose.scheme === 'webauthn' ? pending.purpose.account === undefined : pending.purpose.kind === 'sign-in';
		this.#page = page;
		let redeem: CodeRedemption;
		try {
			redeem = page.redemption(pending, returned.response);
		} catch (cause) {
			this.#returnFailed(pending, signInPageError(cause), signsIn);
			return;
		}
		if (pending.purpose.scheme === 'external' && pending.purpose.kind === 'sign-in') this.#redeemSignIn(pending, redeem, page);
		else this.returned = { pending, redeem };
	}

	/** `sign-in-page.ts`, once an answer brought it (`followReturn`). */
	#page: SignInPageModule | undefined;

	#redeemSignIn(pending: PendingAuthorization, redeem: CodeRedemption, page: SignInPageModule): void {
		const chat = this.host.client();
		if (!chat) return;
		const switched = pending.server !== chat.url;
		this.#work('signing-in', async () => {
			this.host.feedback.pending('Signing in…');
			try {
				await page.finishAuthorization(chat, pending, redeem, () => this.host.beforeSwitch(switched));
			} catch (cause) {
				this.host.feedback.clear();
				this.#returnFailed(pending, signInPageError(cause), true);
				return;
			}
			this.host.feedback.clear();
			this.failure = undefined;
			this.host.signedIn(pending.server, switched);
		});
	}

	/** Why a returned sign-in didn't work: the connect screen opens on its scheme and server for a sign-in, else a toast. */
	#returnFailed(pending: PendingAuthorization, error: string, signsIn: boolean): void {
		if (!signsIn) {
			this.host.feedback.error(error);
			return;
		}
		this.failure = { error };
		this.host.failed({ error, server: pending.server, scheme: pending.purpose.scheme });
	}

	/** The viewer confirmed signing in with the asked link. */
	confirm(): void {
		if (this.asked) this.use({ kind: 'ask', link: this.asked });
	}

	/** The viewer said no to the asked link: nothing is used. */
	cancel(): void {
		this.asked = undefined;
	}

	/**
	 * Signs in with a link of this browser's own proposal, or one the viewer
	 * confirmed: the client presents its token on a fresh connection that is
	 * not signed in (§4.11.3), and carries on with it once it has worked. A
	 * failure changes nothing and opens the connect screen on the link's
	 * scheme and server, with the reason.
	 */
	use(use: Exclude<LinkUse, { kind: 'addition' }>): void {
		const chat = this.host.client();
		// Without a client yet, or while another link signs in or adds, an asked link stays asked.
		if (!chat || this.busy) return;
		this.asked = undefined;
		this.failure = undefined;
		this.#work('signing-in', () => this.#signIn(use, chat));
	}

	#signIn(use: Exclude<LinkUse, { kind: 'addition' }>, chat: LinkClient): Promise<unknown> {
		this.host.feedback.pending('Signing in…');
		return runSignInLink(use, chat, {
			beforeSwitch: (switched) => this.host.beforeSwitch(switched),
			onSignedIn: (server, switched) => {
				this.host.feedback.clear();
				this.failure = undefined;
				this.host.signedIn(server, switched);
			},
			onFailed: (error, server) => {
				this.host.feedback.clear();
				this.failure = { error: linkFailure(use, error) };
				this.host.failed({ error: this.failure.error, server, ...(use.kind === 'own' ? { scheme: use.scheme } : {}) });
			}
		});
	}

	/**
	 * Adds the asked link to the account this page is signed in to, once the
	 * viewer said it was sent for that (§4.11.3): the server approves it only
	 * if that account proposed it, so any other link is refused, and changes
	 * nothing.
	 */
	addAsked(): void {
		const link = this.asked;
		const chat = this.host.client();
		if (!link || !chat || this.busy) return;
		this.asked = undefined;
		this.#work('adding', () => {
			this.host.feedback.pending('Adding the sign-in…');
			return chat.addWithConfirmedLink(link.token)
				.then(() => this.host.feedback.clear(), (cause: unknown) => this.host.feedback.error(addError(cause, 'link')));
		});
	}

	/**
	 * A returned addition or passkey finishes on the page's own connection
	 * (§4.10, §4.12.4), once its session has settled, as an addition's link
	 * does: on the server it began on, signed in as the account it adds to,
	 * where it adds one. A passkey login, or a new account's passkey, signs
	 * this connection in.
	 */
	#settleReturn(snapshot: Parameters<SignInLinks['settle']>[0]): void {
		const returned = this.returned;
		const chat = this.host.client();
		const page = this.#page;
		if (!returned || !chat || !page || this.busy || !sessionSettled(snapshot)) return;
		untrack(() => {
			this.returned = undefined;
			const { pending, redeem } = returned;
			const purpose = pending.purpose;
			const adds = purpose.scheme === 'external' || purpose.account !== undefined;
			this.#work('adding', async () => {
				this.host.feedback.pending(adds ? 'Adding…' : 'Signing in…');
				try {
					await page.finishAuthorization(chat, pending, redeem);
				} catch (cause) {
					this.host.feedback.clear();
					this.#returnFailed(pending, purpose.scheme === 'external' ? addError(cause, 'external') : signInPageError(cause), !adds);
					return;
				}
				this.host.feedback.clear();
				if (!adds) this.host.signedIn(pending.server, false);
			});
		});
	}

	/**
	 * A link for an addition this browser proposed approves only on a
	 * connection signed in to the account that proposed it: once the page's
	 * session has settled (a kept one resumed, or past resuming), it adds
	 * there, or says it can't. Run from an effect with each snapshot.
	 */
	settle(snapshot: Pick<ClientSnapshot, 'status' | 'authBusy' | 'authenticated' | 'held' | 'error' | 'keptSession' | 'server' | 'you'>): void {
		this.#settleReturn(snapshot);
		const addition = this.addition;
		const chat = this.host.client();
		// Another link under way: this one waits for it, and the next snapshot after.
		if (!addition || !chat || this.busy || !sessionSettled(snapshot)) return;
		const signedInAs = snapshot.authenticated ? snapshot.you?.user_id : undefined;
		untrack(() => {
			this.addition = undefined;
			if (chat.url !== addition.server || signedInAs !== addition.account) {
				this.host.feedback.error(`The link adds a sign-in to @${addition.account} on ${serverLabel(addition.server) || addition.server}, which this page isn’t signed in as now. Sign in as @${addition.account} there, and add it again.`);
				return;
			}
			this.#work('adding', () => {
				this.host.feedback.pending('Adding the sign-in…');
				return chat.addWithLink(addition.token, addition.state)
					.then(() => this.host.feedback.clear(), (cause: unknown) => this.host.feedback.error(addError(cause, this.host.findProposal(addition.state)?.scheme)));
			});
		});
	}
}

/**
 * Why a link didn't sign in, and what to do. One of this browser's own may
 * have expired or been used: start again. One of no proposal here may have
 * been for an addition instead, which a new sign-in code wouldn't help with.
 */
export function linkFailure(use: Exclude<LinkUse, { kind: 'addition' }>, error: string): string {
	return use.kind === 'own'
		? `The sign-in link didn’t work (${error}). ${use.scheme === 'email' ? 'Send a new code' : 'Sign in again'} to try again, or pick another server.`
		: askedLinkFailure(error);
}
