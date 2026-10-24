/*
 * What rooms and threads are called. One rule, shared by the client's titles (`roomTitle` in
 * protocol/client-internals.ts) and the design system's names (`roomName` in design/components/util.ts), so the
 * two never disagree. No protocol state and no design-system code: both import it, neither from the other.
 */

/** What a thread without a title is called (`roomName` with `thread`). */
export const UNTITLED = 'Untitled';

/** Whether a room's or thread's `title` names it: an empty or all-space one counts as none, so nothing is ever named by a blank. */
export function titled(title: string | undefined | null): title is string {
	return typeof title === 'string' && Boolean(title.trim());
}

/**
 * What a room or thread is called wherever it is named (rows, cards, headers, breadcrumbs, menus, placeholders): its
 * `title`, else its `room_id` (§3.4: "absent: shown as room_id"). A thread (a room with a `parent_room_id`), named
 * with `thread`, falls back to "Untitled" instead: its `room_id` says nothing to people, and it's always seen under
 * its parent; `roomNameTip` gives the `room_id` for a tooltip wherever that shows. A top-level room keeps its
 * `room_id`, since several untitled rooms side by side would be indistinguishable.
 */
export function roomName(title: string | undefined | null, roomId: string | undefined, options: { thread?: boolean } = {}): string {
	if (titled(title)) return title;
	return options.thread ? UNTITLED : (roomId ?? '');
}

/** The tooltip for a name `roomName` fell back on for a thread ("Untitled"): its `room_id`, so it can still be told apart. Otherwise none. */
export function roomNameTip(title: string | undefined | null, roomId: string | undefined, options: { thread?: boolean } = {}): string | undefined {
	return options.thread && !titled(title) && roomId ? roomId : undefined;
}
