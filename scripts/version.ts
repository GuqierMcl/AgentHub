import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export function getAgentHubVersionFromPackageJson(packageJsonText: string): string {
	const manifest = JSON.parse(packageJsonText) as { version?: unknown }
	if (typeof manifest.version !== "string" || manifest.version.trim() === "") {
		throw new Error("Root package.json must declare a string version")
	}
	return manifest.version.trim()
}

export function readAgentHubVersion(
	projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
): string {
	return getAgentHubVersionFromPackageJson(
		readFileSync(resolve(projectRoot, "package.json"), "utf8"),
	)
}

export function assertReleaseTagMatchesVersion(tag: string, version: string): void {
	const expectedTag = `v${version}`
	if (tag !== expectedTag) {
		throw new Error(`Release tag ${tag} does not match root package version ${version}`)
	}
}
