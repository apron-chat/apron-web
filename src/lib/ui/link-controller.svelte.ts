import { untrack } from 'svelte';
import type { ClientSnapshot } from '$lib/protocol/client';
import type { Proposal, ProposalScheme } from '$lib/protocol/proposals';
import { addError, backendHost } from './connection';
import { askedLinkFailure, linkUse, runSignInLink, sessionSettled, type LinkUse, type SignInLink, type SignInLinkClient } from './sign-in-link';

/**
 * The page's sign-in links (§4.11.2), emailed or the return from an
 * external sign-in page, from the moment one is taken from the URL to the
 * sign-in or addition it makes: the decisions are `sign-in-link.ts`'s, this
 * is their wiring.
 */

/** What the controller needs of the chat client. */
export interface LinkClient extends SignInLinkClient {
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
	failed(failure: { error: string; server: string; scheme?: ProposalScheme }): void;
}

/** An addition this browser proposed, waiting for the session of the account that proposed it. */
type Addition = Extract<LinkUse, { kind: 'addition' }>;

export class SignInLinks {
	/** A link of no proposal this browser made, until the viewer answers whether to use it. */
	asked = $state<SignInLink | undefined>();
	/** A link is being used: its token goes out as a fresh connection's first `auth`, or adds to this account. */
	busy = $state(false);
	/** A link for an addition this browser proposed (§4.11.3), waiting for the session of the account that proposed it. */
	addition = $state<Addition | undefined>();
	/** Why a link didn't sign in, for the connect screen. */
	failure = $state<{ error: string } | undefined>();

	constructor(private readonly host: LinkHost) {}

	/**
	 * A link taken from the URL. One with the `state` of a sign-in this
	 * browser proposed is used at once, on the server it was proposed to; one
	 * for an addition waits for the session of the account that proposed it;
	 * any other is a credential someone else may have crafted or forwarded,
	 * and the viewer is asked first. One that can't be used is dropped.
	 */
	follow(link: SignInLink): void {
		const use = linkUse(link, (state) => this.host.findProposal(state));
		if (!use) return;
		if (use.kind === 'addition') this.addition = use;
		else if (use.kind === 'own') this.use(use);
		else this.asked = use.link;
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
		this.asked = undefined;
		if (!chat) return;
		this.busy = true;
		this.host.feedback.pending('Signing in…');
		void runSignInLink(use, chat, {
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
		}).finally(() => (this.busy = false));
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
		this.asked = undefined;
		if (!link || !chat) return;
		this.busy = true;
		this.host.feedback.pending('Adding the sign-in…');
		chat.addWithConfirmedLink(link.token)
			.then(() => this.host.feedback.clear(), (cause: unknown) => this.host.feedback.error(addError(cause, 'link')))
			.finally(() => (this.busy = false));
	}

	/**
	 * A link for an addition this browser proposed approves only on a
	 * connection signed in to the account that proposed it: once the page's
	 * session has settled (a kept one resumed, or past resuming), it adds
	 * there, or says it can't. Run from an effect with each snapshot.
	 */
	settle(snapshot: Pick<ClientSnapshot, 'status' | 'authBusy' | 'authenticated' | 'held' | 'error' | 'keptSession' | 'server' | 'you'>): void {
		const addition = this.addition;
		const chat = this.host.client();
		if (!addition || !chat || !sessionSettled(snapshot)) return;
		const signedInAs = snapshot.authenticated ? snapshot.you?.user_id : undefined;
		untrack(() => {
			this.addition = undefined;
			if (chat.url !== addition.server || signedInAs !== addition.account) {
				this.host.feedback.error(`The link adds a sign-in to @${addition.account} on ${backendHost(addition.server) || addition.server}, which this page isn’t signed in as now. Sign in as @${addition.account} there, and add it again.`);
				return;
			}
			this.busy = true;
			this.host.feedback.pending('Adding the sign-in…');
			chat.addWithLink(addition.token, addition.state)
				.then(() => this.host.feedback.clear(), (cause: unknown) => this.host.feedback.error(addError(cause, this.host.findProposal(addition.state)?.scheme)))
				.finally(() => (this.busy = false));
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
