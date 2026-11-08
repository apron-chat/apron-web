import { isJsonObject, type JsonObject, type MessageRecord } from './types';

/**
 * Extension `ext:editors`: a message's sender shares the editing of its text with the users it mentions. The
 * sender sends `ext.editors` `{"body.text": "mentioned"}`; each user in the current `body.mentions` may then save
 * `body.text`, and the server keeps every other field. It marks such a snapshot with `edited_by`.
 */

/** The `ext` that shares a new message's text with the users it mentions. */
export const SHARED_TEXT: JsonObject = { editors: { 'body.text': 'mentioned' } };

function editorsOf(message: MessageRecord): JsonObject | undefined {
	const editors = message.ext?.editors;
	return isJsonObject(editors) ? editors : undefined;
}

/** Whether the message shares its text with the users it mentions; a key or value this client doesn't know shares nothing. */
export function sharesText(message: MessageRecord): boolean {
	return !message.deleted && editorsOf(message)?.['body.text'] === 'mentioned';
}

/** Whether `userId`, who didn't send it, may save the message's text: it shares it, and mentions them. */
export function mayEditText(message: MessageRecord, userId: string | undefined): boolean {
	if (!userId || message.from?.user_id === userId || !sharesText(message)) return false;
	const mentions = message.body?.mentions;
	return Array.isArray(mentions) && mentions.includes(userId);
}

/** Who saved this snapshot of the message, when not its sender (`edited_by`, set by the server). */
export function editedBy(message: MessageRecord): string | undefined {
	const by = editorsOf(message)?.edited_by;
	return typeof by === 'string' && by && by !== message.from?.user_id ? by : undefined;
}
