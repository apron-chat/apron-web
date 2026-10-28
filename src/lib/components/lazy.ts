import { Lazy } from '$lib/ui/lazy.svelte';

/** The on-demand chunk (`on-demand.ts`): the first component asked for loads them all, in one request. */
const onDemand = () => import('./on-demand');

export const messageEditor = new Lazy(() => onDemand().then((m) => m.MessageEditor));
export const newPrivateDialog = new Lazy(() => onDemand().then((m) => m.NewPrivateDialog));
export const newRoomDialog = new Lazy(() => onDemand().then((m) => m.NewRoomDialog));
export const newThreadDialog = new Lazy(() => onDemand().then((m) => m.NewThreadDialog));
export const preferencesDialog = new Lazy(() => onDemand().then((m) => m.PreferencesDialog));
export const roomEditor = new Lazy(() => onDemand().then((m) => m.RoomEditor));
export const signInLinkDialog = new Lazy(() => onDemand().then((m) => m.SignInLinkDialog));
export const signInQrDialog = new Lazy(() => onDemand().then((m) => m.SignInQrDialog));
