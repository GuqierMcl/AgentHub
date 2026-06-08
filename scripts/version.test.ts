import { describe, expect, it } from "bun:test"
import {
	assertReleaseTagMatchesVersion,
	getAgentHubVersionFromPackageJson,
	readAgentHubVersion,
} from "./version"

describe("AgentHub version source", () => {
	it("reads the version from the root package manifest", () => {
		expect(getAgentHubVersionFromPackageJson('{"name":"agenthub","version":"0.2.3"}')).toBe("0.2.3")
	})

	it("uses 1.0.3 as the current repository version", () => {
		expect(readAgentHubVersion()).toBe("1.0.3")
	})

	it("rejects package manifests without a string version", () => {
		expect(() => getAgentHubVersionFromPackageJson('{"name":"agenthub"}')).toThrow(
			"Root package.json must declare a string version",
		)
	})

	it("accepts release tags that match the root package version", () => {
		expect(() => assertReleaseTagMatchesVersion("v0.2.3", "0.2.3")).not.toThrow()
	})

	it("rejects release tags that do not match the root package version", () => {
		expect(() => assertReleaseTagMatchesVersion("v0.2.4", "0.2.3")).toThrow(
			"Release tag v0.2.4 does not match root package version 0.2.3",
		)
	})
})
