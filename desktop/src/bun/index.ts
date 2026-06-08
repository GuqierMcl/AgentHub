import { dlopen, FFIType } from "bun:ffi";
import type {
	BrowserWindow as ElectrobunBrowserWindow,
	ElectrobunRPCSchema,
} from "electrobun/bun";

const DEFAULT_DESKTOP_URL = "http://127.0.0.1:5173";
const MAIN_WINDOW_FRAME = {
	width: 1280,
	height: 860,
	x: 200,
	y: 120,
};
const INITIAL_LAYOUT_FALLBACK_DELAY_MS = 500;
const NOTIFICATION_TITLE_MAX_LENGTH = 120;
const NOTIFICATION_SUBTITLE_MAX_LENGTH = 120;
const NOTIFICATION_BODY_MAX_LENGTH = 500;
const DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4;
const PROCESS_PER_MONITOR_DPI_AWARE = 2;
const desktopUrl = process.env.AGENTHUB_DESKTOP_URL?.trim() || DEFAULT_DESKTOP_URL;

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
await checkDesktopUrl(desktopUrl);

const { BrowserWindow, Utils, defineElectrobunRPC } = await import(
	"electrobun/bun"
);

let mainWindow: ElectrobunBrowserWindow | null = null;

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

mainWindow = new BrowserWindow({
	title: "AgentHub",
	url: desktopUrl,
	frame: MAIN_WINDOW_FRAME,
	titleBarStyle: "hiddenInset",
	transparent: false,
	rpc: desktopWindowRpc,
});
refreshInitialLayout(mainWindow);

const windows = [mainWindow];

console.log(`AgentHub desktop started at ${desktopUrl} (${windows.length} window)`);
