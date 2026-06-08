import { dlopen, FFIType } from "bun:ffi";
import { pathToFileURL } from "node:url";
import type {
	BrowserWindow as ElectrobunBrowserWindow,
	ElectrobunRPCSchema,
} from "electrobun/bun";
import {
	assertDesktopResourcePaths,
	findAvailablePort,
	resolveDesktopAppAssetPath,
	resolveDesktopResourcePaths,
	resolveDesktopResourceRoot,
	shutdownDesktopHubServer,
	startDesktopHubServer,
	type DesktopHubServerProcess,
	type RunningDesktopHubServer,
} from "./agenthub-service";
import { createLoadingWindowHtml } from "./loading-window";

const DEFAULT_DESKTOP_URL = "http://127.0.0.1:5173";
const DESKTOP_BUILD_MODE = process.env.AGENTHUB_DESKTOP_BUILD_MODE ?? "development";
const MAIN_WINDOW_FRAME = {
	width: 1280,
	height: 860,
	x: 200,
	y: 120,
};
const LOADING_WINDOW_FRAME = {
	width: 420,
	height: 240,
	x: 320,
	y: 220,
};
const INITIAL_LAYOUT_FALLBACK_DELAY_MS = 500;
const NOTIFICATION_TITLE_MAX_LENGTH = 120;
const NOTIFICATION_SUBTITLE_MAX_LENGTH = 120;
const NOTIFICATION_BODY_MAX_LENGTH = 500;
const DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4;
const PROCESS_PER_MONITOR_DPI_AWARE = 2;
const configuredDesktopUrl = process.env.AGENTHUB_DESKTOP_URL?.trim();

type WindowState = {
	maximized: boolean;
};

type DesktopNotificationOptions = {
	title: string;
	body?: string;
	subtitle?: string;
	silent?: boolean;
};

type DesktopWindowRPCSchema = ElectrobunRPCSchema & {
	bun: {
		requests: {
			minimize: {
				params: void;
				response: void;
			};
			close: {
				params: void;
				response: void;
			};
			toggleMaximize: {
				params: void;
				response: WindowState;
			};
			getWindowState: {
				params: void;
				response: WindowState;
			};
			showNotification: {
				params: DesktopNotificationOptions;
				response: void;
			};
			showDebugNotification: {
				params: void;
				response: void;
			};
		};
		messages: Record<never, never>;
	};
	webview: {
		requests: Record<never, never>;
		messages: Record<never, never>;
	};
};

function configureWindowsDpiAwareness(): void {
	if (process.platform !== "win32") {
		return;
	}

	try {
		const user32 = dlopen("user32.dll", {
			SetProcessDpiAwarenessContext: {
				args: [FFIType.i64],
				returns: FFIType.bool,
			},
		});

		const enabledPerMonitorV2 = user32.symbols.SetProcessDpiAwarenessContext(
			DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
		);

		if (enabledPerMonitorV2) {
			console.log("AgentHub desktop enabled per-monitor v2 DPI awareness.");
			return;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(
			`AgentHub desktop could not enable per-monitor v2 DPI awareness. ${message}`,
		);
	}

	try {
		const shcore = dlopen("shcore.dll", {
			SetProcessDpiAwareness: {
				args: [FFIType.i32],
				returns: FFIType.i32,
			},
		});
		const result = shcore.symbols.SetProcessDpiAwareness(
			PROCESS_PER_MONITOR_DPI_AWARE,
		);

		if (result === 0) {
			console.log("AgentHub desktop enabled per-monitor DPI awareness.");
			return;
		}

		console.warn(
			`AgentHub desktop could not enable per-monitor DPI awareness. HRESULT: ${result}`,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(
			`AgentHub desktop could not configure Windows DPI awareness. ${message}`,
		);
	}
}

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

function nudgeLayout(window: ElectrobunBrowserWindow): void {
	const { width, height } = window.getSize();
	window.setSize(width, height + 1);
	setTimeout(() => {
		window.setSize(width, height);
	}, 16);
}

function refreshInitialLayout(window: ElectrobunBrowserWindow): void {
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

function truncateNotificationText(
	value: string | undefined,
	maxLength: number,
): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed) {
		return undefined;
	}

	return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function normalizeNotificationOptions(
	options: unknown,
): DesktopNotificationOptions {
	const input =
		options && typeof options === "object"
			? (options as Record<string, unknown>)
			: {};
	const title = typeof input.title === "string" ? input.title : undefined;
	const body = typeof input.body === "string" ? input.body : undefined;
	const subtitle =
		typeof input.subtitle === "string" ? input.subtitle : undefined;
	const silent = typeof input.silent === "boolean" ? input.silent : undefined;

	return {
		title:
			truncateNotificationText(
				title,
				NOTIFICATION_TITLE_MAX_LENGTH,
			) ?? "AgentHub",
		body: truncateNotificationText(
			body,
			NOTIFICATION_BODY_MAX_LENGTH,
		),
		subtitle: truncateNotificationText(
			subtitle,
			NOTIFICATION_SUBTITLE_MAX_LENGTH,
		),
		silent,
	};
}

configureWindowsDpiAwareness();

const { BrowserWindow, Utils, defineElectrobunRPC } = await import(
	"electrobun/bun"
);

let mainWindow: ElectrobunBrowserWindow | null = null;
let loadingWindow: ElectrobunBrowserWindow | null = null;
let runningHubServer: RunningDesktopHubServer | null = null;
let startingHubServerProcess: DesktopHubServerProcess | null = null;

const desktopWindowRpc = defineElectrobunRPC<DesktopWindowRPCSchema>("bun", {
	handlers: {
		requests: {
			minimize: () => {
				mainWindow?.minimize();
			},
			close: () => {
				mainWindow?.close();
			},
			toggleMaximize: () => {
				if (!mainWindow) {
					return { maximized: false };
				}

				if (mainWindow.isMaximized()) {
					mainWindow.unmaximize();
					return { maximized: false };
				}

				mainWindow.maximize();
				return { maximized: true };
			},
			getWindowState: () => {
				return { maximized: mainWindow?.isMaximized() ?? false };
			},
			showNotification: (options?: unknown) => {
				const notification = normalizeNotificationOptions(options);
				Utils.showNotification({
					title: notification.title,
					body: notification.body,
					subtitle: notification.subtitle,
					silent: notification.silent,
				});
			},
			showDebugNotification: () => {
				Utils.showNotification({
					title: "AgentHub",
					body: "硬编码 Utils 测试通知。",
				});
			},
		},
	},
});

function createMainWindow(url: string): ElectrobunBrowserWindow {
	const window = new BrowserWindow({
		title: "AgentHub",
		url,
		frame: MAIN_WINDOW_FRAME,
		titleBarStyle: "hiddenInset",
		transparent: false,
		rpc: desktopWindowRpc,
	});
	refreshInitialLayout(window);
	return window;
}

function createLoadingWindow(): ElectrobunBrowserWindow {
	const iconUrl = pathToFileURL(resolveDesktopAppAssetPath("icon.png")).href

	return new BrowserWindow({
		title: "AgentHub",
		url: null,
		html: createLoadingWindowHtml(iconUrl),
		frame: LOADING_WINDOW_FRAME,
		titleBarStyle: "default",
		transparent: false,
	});
}

function closeLoadingWindow(): void {
	const window = loadingWindow
	if (!window) {
		return
	}
	window.close()
	loadingWindow = null
}

async function startProductionDesktop(): Promise<string> {
	const resourceRoot = resolveDesktopResourceRoot()
	const paths = resolveDesktopResourcePaths(resourceRoot)
	await assertDesktopResourcePaths(paths)
	const port = await findAvailablePort()
	const running = await startDesktopHubServer({
		port,
		paths,
		logLevel: process.env.AGENTHUB_DESKTOP_LOG_LEVEL?.trim() || undefined,
		onProcess: (process) => {
			startingHubServerProcess = process
		},
	})

	runningHubServer = running
	startingHubServerProcess = null
	return running.url
}

async function stopHubServer(signal: NodeJS.Signals = "SIGTERM"): Promise<number | null> {
	if (runningHubServer) {
		const running = runningHubServer
		runningHubServer = null
		return shutdownDesktopHubServer(running.process, signal)
	}

	if (startingHubServerProcess) {
		const process = startingHubServerProcess
		startingHubServerProcess = null
		return shutdownDesktopHubServer(process, signal)
	}

	return null
}

function installShutdownHandlers(): void {
	let shuttingDown = false
	const shutdown = (signal: NodeJS.Signals) => {
		if (shuttingDown) {
			return
		}
		shuttingDown = true
		stopHubServer(signal)
			.then((exitCode) => process.exit(exitCode ?? 0))
			.catch((error) => {
				console.error("Failed to stop HubServer", error)
				process.exit(1)
			})
	}

	process.on("SIGINT", () => shutdown("SIGINT"))
	process.on("SIGTERM", () => shutdown("SIGTERM"))
	process.on("exit", () => {
		runningHubServer?.process.kill("SIGTERM")
		startingHubServerProcess?.kill("SIGTERM")
	})
}

async function resolveDesktopUrl(): Promise<string> {
	if (configuredDesktopUrl) {
		await checkDesktopUrl(configuredDesktopUrl)
		return configuredDesktopUrl
	}

	if (DESKTOP_BUILD_MODE !== "production") {
		await checkDesktopUrl(DEFAULT_DESKTOP_URL)
		return DEFAULT_DESKTOP_URL
	}

	loadingWindow = createLoadingWindow()
	return startProductionDesktop()
}

installShutdownHandlers();

try {
	const desktopUrl = await resolveDesktopUrl()
	mainWindow = createMainWindow(desktopUrl)
	closeLoadingWindow()

	const windows = [mainWindow]
	console.log(`AgentHub desktop started at ${desktopUrl} (${windows.length} window)`);
} catch (error) {
	console.error("AgentHub desktop failed to start", error)
	await stopHubServer()
	process.exit(1)
}
