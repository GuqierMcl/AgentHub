import { stat } from "node:fs/promises"
import { createServer } from "node:net"
import { dirname, posix, resolve, win32 } from "node:path"

export const DESKTOP_RESOURCE_DIR_NAME = "agenthub-runtime"

export interface DesktopResourcePaths {
	bunBin: string
	hubServerEntry: string
	hubServerNodeModulesDir: string
	runtimeEntry: string
	runtimeNodeModulesDir: string
	publicDir: string
}

export interface DesktopHubServerProcess {
	exited: Promise<number | null>
	kill(signal?: NodeJS.Signals): void
}

export interface RunningDesktopHubServer {
	url: string
	process: DesktopHubServerProcess
}

interface StartDesktopHubServerOptions {
	port: number
	paths: DesktopResourcePaths
	dataDir?: string
	logLevel?: string
	readyTimeoutMs?: number
	spawn?: (command: string[]) => DesktopHubServerProcess
	onProcess?: (process: DesktopHubServerProcess) => void
	fetchHealth?: (url: string) => Promise<boolean>
	sleep?: (ms: number) => Promise<void>
}

function pathForPlatform(platform: NodeJS.Platform): typeof posix | typeof win32 {
	return platform === "win32" ? win32 : posix
}

export function resolveDesktopResourceRoot(options: {
	env?: NodeJS.ProcessEnv
	execPath?: string
} = {}): string {
	const override = options.env?.AGENTHUB_DESKTOP_RESOURCES_DIR?.trim()
	if (override) {
		return resolve(override)
	}

	return resolve(dirname(options.execPath ?? process.execPath), "..", "Resources", "app", DESKTOP_RESOURCE_DIR_NAME)
}

export function resolveDesktopResourcePaths(
	resourceRoot: string,
	platform: NodeJS.Platform = process.platform,
): DesktopResourcePaths {
	const path = pathForPlatform(platform)
	const exe = platform === "win32" ? ".exe" : ""

	return {
		bunBin: path.join(resourceRoot, `bun${exe}`),
		hubServerEntry: path.join(resourceRoot, "hub-server", "index.js"),
		hubServerNodeModulesDir: path.join(resourceRoot, "hub-server", "node_modules"),
		runtimeEntry: path.join(resourceRoot, "agent-runtime", "index.js"),
		runtimeNodeModulesDir: path.join(resourceRoot, "agent-runtime", "node_modules"),
		publicDir: path.join(resourceRoot, "public"),
	}
}

async function assertFile(path: string, label: string): Promise<void> {
	const info = await stat(path).catch(() => null)
	if (!info?.isFile()) {
		throw new Error(`Missing ${label}: ${path}`)
	}
}

async function assertDirectory(path: string, label: string): Promise<void> {
	const info = await stat(path).catch(() => null)
	if (!info?.isDirectory()) {
		throw new Error(`Missing ${label}: ${path}`)
	}
}

export async function assertDesktopResourcePaths(paths: DesktopResourcePaths): Promise<void> {
	await assertFile(paths.bunBin, "Bun runtime")
	await assertFile(paths.hubServerEntry, "HubServer bundle")
	await assertDirectory(paths.hubServerNodeModulesDir, "HubServer node_modules directory")
	await assertFile(paths.runtimeEntry, "Agent Runtime bundle")
	await assertDirectory(paths.runtimeNodeModulesDir, "Agent Runtime node_modules directory")
	await assertDirectory(paths.publicDir, "Web public directory")
}

export async function findAvailablePort(hostname = "127.0.0.1"): Promise<number> {
	return new Promise((resolvePort, reject) => {
		const server = createServer()
		server.once("error", reject)
		server.listen(0, hostname, () => {
			const address = server.address()
			server.close(() => {
				if (typeof address === "object" && address) {
					resolvePort(address.port)
					return
				}
				reject(new Error("Failed to allocate an available port"))
			})
		})
	})
}

export function createHubServerCommand(options: {
	port: number
	paths: DesktopResourcePaths
	dataDir?: string
	logLevel?: string
}): string[] {
	const command = [
		options.paths.bunBin,
		options.paths.hubServerEntry,
		"--port",
		String(options.port),
		"--hostname",
		"127.0.0.1",
		"--bun-bin",
		options.paths.bunBin,
		"--runtime-entry",
		options.paths.runtimeEntry,
		"--public-dir",
		options.paths.publicDir,
	]

	if (options.dataDir) {
		command.push("--data-dir", options.dataDir)
	}
	if (options.logLevel) {
		command.push("--log-level", options.logLevel)
	}

	return command
}

function defaultSpawn(command: string[]): DesktopHubServerProcess {
	return Bun.spawn(command, {
		stdout: "inherit",
		stderr: "inherit",
	}) as DesktopHubServerProcess
}

async function defaultFetchHealth(url: string): Promise<boolean> {
	const response = await fetch(`${url}/health`)
	const body = await response.json().catch(() => null) as { status?: string } | null
	return response.ok && body?.status === "ok"
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

async function waitForHubReady(options: {
	url: string
	readyTimeoutMs: number
	fetchHealth: (url: string) => Promise<boolean>
	sleep: (ms: number) => Promise<void>
}): Promise<void> {
	const deadline = Date.now() + options.readyTimeoutMs
	while (Date.now() < deadline) {
		if (await options.fetchHealth(options.url).catch(() => false)) {
			return
		}
		await options.sleep(200)
	}
	throw new Error(`HubServer did not become ready at ${options.url}`)
}

export async function startDesktopHubServer(
	options: StartDesktopHubServerOptions,
): Promise<RunningDesktopHubServer> {
	const spawn = options.spawn ?? defaultSpawn
	const fetchHealth = options.fetchHealth ?? defaultFetchHealth
	const sleep = options.sleep ?? defaultSleep
	const readyTimeoutMs = options.readyTimeoutMs ?? 30_000
	const url = `http://127.0.0.1:${options.port}`
	const process = spawn(createHubServerCommand(options))
	options.onProcess?.(process)

	try {
		await waitForHubReady({
			url,
			readyTimeoutMs,
			fetchHealth,
			sleep,
		})
	} catch (err) {
		process.kill("SIGTERM")
		throw err
	}

	return {
		url,
		process,
	}
}

export function shutdownDesktopHubServer(
	process: DesktopHubServerProcess,
	signal: NodeJS.Signals = "SIGTERM",
): Promise<number | null> {
	process.kill(signal)
	return process.exited
}
