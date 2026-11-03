/** What a piece of UI says about the last thing it did: shown beside it until the next. */
export type Note = { text: string; error: boolean };

/**
 * One thing at a time that a piece of UI waits on (adding someone to a room, starting a conversation, saving a
 * form), and the note it ends with. Both belong to what the UI showed when it started: a person's card, a room,
 * a dialog as it opened. `reset` starts over for whatever shows next. The work still under way goes on, but no
 * longer counts here: when it settles it notes nothing and frees nothing. So a slow reply can't show its note on
 * the card or room the reader moved to, nor mark that one idle while a request of its own runs.
 *
 * `Kind` names what is running, for UIs that show which (`'add' | 'message'`).
 */
export class Task<Kind extends string = 'busy', N = Note> {
	/** What is under way, if anything: one thing at a time. */
	running = $state<Kind | undefined>();
	note = $state<N | undefined>();
	#turn = 0;

	get busy(): boolean {
		return this.running !== undefined;
	}

	/** What shows now is something else: whatever was under way, or noted, belonged to what went. */
	reset(): void {
		this.#turn += 1;
		this.running = undefined;
		this.note = undefined;
	}

	/**
	 * Runs `work` as `kind`, unless something is under way already (then nothing runs). The note clears as it
	 * starts. Once it settles, its note is what `done` makes of its result (none without `done`), or `failed` of
	 * its error, unless `reset` came first. `work` is passed `still`, whether this run still counts, for what it
	 * does besides noting (closing a card it was started from). Resolves with whether it ran and worked, and
	 * still counts: what to do once it is over and no longer busy, such as closing the form it saved.
	 */
	async run<T>(kind: Kind, work: (still: () => boolean) => Promise<T>, outcome: {
		done?: (value: T) => N | undefined;
		failed: (cause: unknown) => N | undefined;
	}): Promise<boolean> {
		if (this.running !== undefined) return false;
		const turn = ++this.#turn;
		const still = (): boolean => turn === this.#turn;
		this.running = kind;
		this.note = undefined;
		let worked = false;
		try {
			const value = await work(still);
			if (still()) this.note = outcome.done?.(value);
			worked = true;
		} catch (cause) {
			if (still()) this.note = outcome.failed(cause);
		} finally {
			if (still()) this.running = undefined;
		}
		return worked && still();
	}
}

/** What a failure says: its message, else `fallback`. */
export function messageOf(cause: unknown, fallback: string): string {
	return cause instanceof Error && cause.message ? cause.message : fallback;
}

/** The note for a failure: its message, else `fallback`. */
export function failure(fallback: string): (cause: unknown) => Note {
	return (cause) => ({ text: messageOf(cause, fallback), error: true });
}
