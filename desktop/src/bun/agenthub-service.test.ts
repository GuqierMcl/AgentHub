import { describe, expect, it } from "bun:test"
import {
	createHubServerCommand,
	resolveDesktopResourceRoot,
	resolveDesktopResourcePaths,
	startDesktopHubServer,
	type DesktopHubServerProcess,
} from "./agenthub-service"

function neverExitProcess(kills: string[]): DesktopHubServerProcess {
	return {
		exited: new Promise<number>(() => {}),
		kill: (signal?: NodeJS.Signals) => {
			kills.push(signal ?? "SIGTERM")
		},
	}
}

describe("Desktop AgentHub service bootstrap", () => {
	it("resolves the default packaged resource root under Electrobun Resources/app", () => {
		const resourceRoot = resolveDesktopResourceRoot({
			execPath: "C:/AgentHub/bin/launcher.exe",
			env: {},
		})

		expect(resourceRoot).toBe("C:\\AgentHub\\Resources\\app\\agenthub-runtime")
	})

	it("resolves production resources from the packaged resource root on Windows", () => {
		const paths = resolveDesktopResourcePaths("C:/AgentHub/Resources/agenthub-runtime", "win32")

		expect(paths.bunBin).toBe("C:\\AgentHub\\Resources\\agenthub-runtime\\bun.exe")
		expect(paths.hubServerEntry).toBe("C:\\AgentHub\\Resources\\agenthub-runtime\\hub-server\\index.js")
		expect(paths.hubServerNodeModulesDir).toBe("C:\\AgentHub\\Resources\\agenthub-runtime\\hub-server\\node_modules")
		expect(paths.runtimeEntry).toBe("C:\\AgentHub\\Resources\\agenthub-runtime\\agent-runtime\\index.js")
		expect(paths.runtimeNodeModulesDir).toBe("C:\\AgentHub\\Resources\\agenthub-runtime\\agent-runtime\\node_modules")
		expect(paths.publicDir).toBe("C:\\AgentHub\\Resources\\agenthub-runtime\\public")
	})

	it("creates the HubServer production command used by Desktop", () => {
		const command = createHubServerCommand({
			port: 4567,
			paths: {
				bunBin: "C:/AgentHub/Resources/agenthub-runtime/bun.exe",
				hubServerEntry: "C:/AgentHub/Resources/agenthub-runtime/hub-server/index.js",
				hubServerNodeModulesDir: "C:/AgentHub/Resources/agenthub-runtime/hub-server/node_modules",
				runtimeEntry: "C:/AgentHub/Resources/agenthub-runtime/agent-runtime/index.js",
				runtimeNodeModulesDir: "C:/AgentHub/Resources/agenthub-runtime/agent-runtime/node_modules",
				publicDir: "C:/AgentHub/Resources/agenthub-runtime/public",
			},
			logLevel: "info",
		})

		expect(command).toEqual([
			"C:/AgentHub/Resources/agenthub-runtime/bun.exe",
			"C:/AgentHub/Resources/agenthub-runtime/hub-server/index.js",
			"--port",
			"4567",
			"--hostname",
			"127.0.0.1",
			"--bun-bin",
			"C:/AgentHub/Resources/agenthub-runtime/bun.exe",
			"--runtime-entry",
			"C:/AgentHub/Resources/agenthub-runtime/agent-runtime/index.js",
			"--public-dir",
			"C:/AgentHub/Resources/agenthub-runtime/public",
			"--log-level",
			"info",
		])
	})

	it("waits for HubServer readiness before returning the app URL", async () => {
		const commands: string[][] = []
		const kills: string[] = []
		const running = await startDesktopHubServer({
			port: 4567,
			paths: {
				bunBin: "bun",
				hubServerEntry: "hub-server/index.js",
				hubServerNodeModulesDir: "hub-server/node_modules",
				runtimeEntry: "agent-runtime/index.js",
				runtimeNodeModulesDir: "agent-runtime/node_modules",
				publicDir: "public",
			},
			spawn: (command) => {
				commands.push(command)
				return neverExitProcess(kills)
			},
			fetchHealth: async () => true,
			sleep: async () => {},
		})

		expect(running.url).toBe("http://127.0.0.1:4567")
		expect(commands).toHaveLength(1)
		expect(kills).toEqual([])
	})

	it("terminates HubServer when readiness times out", async () => {
		const kills: string[] = []

		await expect(startDesktopHubServer({
			port: 4567,
			paths: {
				bunBin: "bun",
				hubServerEntry: "hub-server/index.js",
				hubServerNodeModulesDir: "hub-server/node_modules",
				runtimeEntry: "agent-runtime/index.js",
				runtimeNodeModulesDir: "agent-runtime/node_modules",
				publicDir: "public",
			},
			spawn: () => neverExitProcess(kills),
			fetchHealth: async () => false,
			sleep: async () => {},
			readyTimeoutMs: 1,
		})).rejects.toThrow("HubServer did not become ready")

		expect(kills).toEqual(["SIGTERM"])
	})
})
