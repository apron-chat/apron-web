/**
 * A draft's text and selection, as a formatting change reads and returns them (`markdown-format.ts`,
 * `DraftField.apply`). Positions count a mention chip as its `@user_id`, `#room_id` or `@&role`, with no space added.
 */
export interface TextEdit {
	text: string;
	/** The selection, `start` ≤ `end`; equal for a bare caret. */
	start: number;
	end: number;
}
