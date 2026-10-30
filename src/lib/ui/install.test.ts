import { describe, expect, it } from 'vitest';
import { installedAlready, installWay } from './install';

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.96 Mobile/15E148 Safari/604.1';
const IPHONE_INSTAGRAM = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 401.0.0.29.81';
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const ANDROID_FIREFOX = 'Mozilla/5.0 (Android 15; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0';
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
const DESKTOP_CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const nav = (userAgent: string, platform = 'iPhone', maxTouchPoints = 5) => ({ userAgent, platform, maxTouchPoints });

describe('installWay', () => {
	it('asks the browser where it offers to install, on a phone', () => {
		expect(installWay(true, nav(ANDROID_CHROME, 'Linux armv81'))).toBe('prompt');
		expect(installWay(false, nav(ANDROID_CHROME, 'Linux armv81'))).toBe('android');
		expect(installWay(false, nav(ANDROID_FIREFOX, 'Linux armv81'))).toBe('android');
	});

	it('tells an iPhone or iPad which Share sheet, and an app’s own browser to open the page in the browser', () => {
		expect(installWay(false, nav(IPHONE_SAFARI))).toBe('ios-safari');
		expect(installWay(false, nav(IPHONE_CHROME))).toBe('ios-browser');
		expect(installWay(false, nav(IPHONE_INSTAGRAM))).toBe('in-app');
		// Opera, DuckDuckGo and the Google app have the Share sheet too, not Safari's menu.
		for (const name of ['OPT/5.6.0', 'Ddg/18.6', 'GSA/392.0.814588402']) expect(installWay(false, nav(IPHONE_SAFARI.replace('Safari/604.1', `${name} Safari/604.1`)))).toBe('ios-browser');
		// An iPad's Safari asks for the desktop site: a Mac with a touch screen.
		expect(installWay(false, nav(MAC_SAFARI, 'MacIntel', 5))).toBe('ios-safari');
	});

	it('offers nothing on a computer, whose browser offers installing itself', () => {
		expect(installWay(true, nav(DESKTOP_CHROME, 'Linux x86_64', 0))).toBeUndefined();
		expect(installWay(false, nav(MAC_SAFARI, 'MacIntel', 0))).toBeUndefined();
		expect(installWay(false, { userAgent: '', platform: '', maxTouchPoints: 0 })).toBeUndefined();
	});
});

describe('installedAlready', () => {
	it('says so where Chrome lists Apron among the related apps installed, and not where it can’t tell', async () => {
		const asking = (apps: unknown[] | Error) => ({ getInstalledRelatedApps: () => (apps instanceof Error ? Promise.reject(apps) : Promise.resolve(apps)) }) as unknown as Navigator;
		expect(await installedAlready(asking([{ platform: 'webapp' }]))).toBe(true);
		expect(await installedAlready(asking([]))).toBe(false);
		expect(await installedAlready(asking(new Error('Not allowed')))).toBe(false);
		expect(await installedAlready({} as Navigator)).toBe(false);
	});
});
