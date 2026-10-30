/**
 * Stands in for `$app/state`'s `page` and `$app/navigation`'s `pushState`, for components that keep a history entry
 * (`vi.mock('$app/state', …)`): `pushState` sets `page.state` as SvelteKit's does, and a test plays Back by setting
 * it back.
 */
export const page = $state({ state: {} as App.PageState });

export const pushes: App.PageState[] = [];

export function pushState(_url: string, state: App.PageState): void {
	pushes.push(state);
	page.state = state;
}
