import { isStandalone } from './web-push';

/**
 * How Apron gets onto this phone's Home Screen, for the offer to put it there (`InstallPrompt`):
 * - `prompt`: the browser offers to install it (`beforeinstallprompt`), and Install asks it.
 * - `ios-safari`: Safari's Share sheet, Add to Home Screen.
 * - `ios-browser`: another iPhone or iPad browser's Share sheet (Chrome, Firefox, Edge, Opera, DuckDuckGo, the Google app), which also has it.
 * - `android`: an Android browser that offers nothing (yet): its own menu's Install app or Add to Home screen.
 * - `in-app`: an app's own browser (Instagram, Facebook and the like), which can't: open the page in the browser first.
 */
export type InstallWay = 'prompt' | 'ios-safari' | 'ios-browser' | 'android' | 'in-app';

/** How long a phone's session is up before the offer is made: not the first thing seen, nor while it loads. */
export const INSTALL_OFFER_AFTER_MS = 20_000;

type InstallNavigator = Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>;

/** iPhone and iPad, an iPad's Safari asking for the desktop site included. */
function isIos(nav: InstallNavigator): boolean {
	return /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
}

/**
 * How this browser installs Apron (`InstallWay`), where it's a phone or tablet's and Apron isn't running installed
 * already; none on a computer, whose browsers offer installing in their own address bar.
 */
export function installWay(offered: boolean, nav: InstallNavigator | undefined = globalThis.navigator): InstallWay | undefined {
	if (!nav || isStandalone()) return undefined;
	const ios = isIos(nav);
	if (!ios && !/Android/.test(nav.userAgent)) return undefined;
	if (offered) return 'prompt';
	if (/FBAN|FBAV|FB_IAB|Instagram|LinkedInApp|Snapchat|TikTok|musical_ly|Line\/|MicroMessenger|Twitter/.test(nav.userAgent)) return 'in-app';
	if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|Ddg\/|GSA\//.test(nav.userAgent) ? 'ios-browser' : 'ios-safari';
	return 'android';
}

/**
 * Chrome on Android says Apron is installed already (`getInstalledRelatedApps`, the manifest's `related_applications`
 * naming it), where it stops offering to install it: no offer then, rather than steps for a menu item that isn't there.
 */
export async function installedAlready(nav: Navigator | undefined = globalThis.navigator): Promise<boolean> {
	const related = (nav as (Navigator & { getInstalledRelatedApps?: () => Promise<unknown[]> }) | undefined)?.getInstalledRelatedApps;
	if (!related) return false;
	try {
		return (await related.call(nav)).length > 0;
	} catch {
		return false;
	}
}
