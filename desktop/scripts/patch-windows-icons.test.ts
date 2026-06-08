import { describe, expect, it } from "bun:test"
import {
	createRceditCommand,
	resolveWindowsIconPatchTargets,
} from "./patch-windows-icons"

describe("Desktop Windows icon patch hook", () => {
	it("targets the wrapped launcher before the installer archive is compressed", () => {
		const targets = resolveWindowsIconPatchTargets({
			platform: "win32",
			env: {
				ELECTROBUN_WRAPPER_BUNDLE_PATH: "C:\\AgentHub\\desktop\\build\\stable-win-x64\\AgentHub",
			},
			exists: (path) => path.endsWith("\\bin\\launcher"),
		})

		expect(targets).toEqual([
			"C:\\AgentHub\\desktop\\build\\stable-win-x64\\AgentHub\\bin\\launcher",
		])
	})

	it("targets the Windows installer after packaging", () => {
		const targets = resolveWindowsIconPatchTargets({
			platform: "win32",
			env: {
				ELECTROBUN_BUILD_DIR: "C:\\AgentHub\\desktop\\build\\stable-win-x64",
				ELECTROBUN_APP_NAME: "AgentHub",
			},
			exists: (path) => path.endsWith("\\AgentHub-Setup.exe"),
		})

		expect(targets).toEqual([
			"C:\\AgentHub\\desktop\\build\\stable-win-x64\\AgentHub-Setup.exe",
		])
	})

	it("does nothing outside Windows", () => {
		const targets = resolveWindowsIconPatchTargets({
			platform: "linux",
			env: {
				ELECTROBUN_BUILD_DIR: "/tmp/build",
				ELECTROBUN_APP_NAME: "AgentHub",
			},
			exists: () => true,
		})

		expect(targets).toEqual([])
	})

	it("creates the rcedit command for a target executable", () => {
		expect(createRceditCommand("C:\\rcedit.exe", "C:\\AgentHub\\AgentHub-Setup.exe", "C:\\icon.ico")).toEqual([
			"C:\\rcedit.exe",
			"C:\\AgentHub\\AgentHub-Setup.exe",
			"--set-icon",
			"C:\\icon.ico",
		])
	})
})
