import { BrowserWindow } from "electrobun/bun";

const DEFAULT_DESKTOP_URL = "http://127.0.0.1:5173";
const MAIN_WINDOW_FRAME = {
	width: 1280,
	height: 860,
	x: 200,
	y: 120,
};
const INITIAL_LAYOUT_FALLBACK_DELAY_MS = 500;
const desktopUrl = process.env.AGENTHUB_DESKTOP_URL?.trim() || DEFAULT_DESKTOP_URL;

async function checkDesktopUrl(url: string): Promise<void> {
	try {
		const response = await fetch(url, { method: "HEAD" });
		if (!response.ok) {
			console.warn(
				`AgentHub web responded with ${response.status} at ${url}. The desktop window will still open.`,
			);
			return;
		}
		console.log(`AgentHub web is reachable at ${url}`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(
			`AgentHub web is not reachable at ${url}. Start it with 'bun run dev:web' before using the desktop shell. ${message}`,
		);
	}
}

function nudgeLayout(window: BrowserWindow): void {
	const { width, height } = window.getSize();
	window.setSize(width, height + 1);
	setTimeout(() => {
		window.setSize(width, height);
	}, 16);
}

function refreshInitialLayout(window: BrowserWindow): void {
	let pageReady = false;

	window.webview.on("dom-ready", () => {
		pageReady = true;
		nudgeLayout(window);
	});

	setTimeout(() => {
		if (!pageReady) {
			nudgeLayout(window);
		}
	}, INITIAL_LAYOUT_FALLBACK_DELAY_MS);
}

await checkDesktopUrl(desktopUrl);

const mainWindow = new BrowserWindow({
	title: "AgentHub",
	url: desktopUrl,
	frame: MAIN_WINDOW_FRAME,
});
refreshInitialLayout(mainWindow);

const windows = [mainWindow];

console.log(`AgentHub desktop started at ${desktopUrl} (${windows.length} window)`);
