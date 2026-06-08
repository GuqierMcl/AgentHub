import { execFileSync } from "node:child_process"
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	rmSync,
} from "node:fs"
import { basename, dirname, join, resolve, win32 } from "node:path"

interface ResolveWindowsIconPatchTargetsOptions {
	platform?: NodeJS.Platform
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>
	exists?: (path: string) => boolean
}

export function createRceditCommand(
	rceditPath: string,
	targetPath: string,
	iconPath: string,
): string[] {
	return [rceditPath, targetPath, "--set-icon", iconPath]
}

function firstExisting(
	candidates: string[],
	exists: (path: string) => boolean,
): string | undefined {
	return candidates.find((candidate) => exists(candidate))
}

export function resolveWindowsIconPatchTargets(
	options: ResolveWindowsIconPatchTargetsOptions = {},
): string[] {
	const platform = options.platform ?? process.platform
	if (platform !== "win32") {
		return []
	}

	const env = options.env ?? process.env
	const exists = options.exists ?? existsSync
	const targets: string[] = []
	const wrapperBundlePath = env.ELECTROBUN_WRAPPER_BUNDLE_PATH?.trim()

	if (wrapperBundlePath) {
		const launcher = firstExisting([
			win32.join(wrapperBundlePath, "bin", "launcher.exe"),
			win32.join(wrapperBundlePath, "bin", "launcher"),
		], exists)

		if (launcher) {
			targets.push(launcher)
		}
	}

	const buildDir = env.ELECTROBUN_BUILD_DIR?.trim()
	const appName = env.ELECTROBUN_APP_NAME?.trim()
	if (buildDir && appName) {
		const installer = win32.join(buildDir, `${appName}-Setup.exe`)
		if (exists(installer)) {
			targets.push(installer)
		}
	}

	return [...new Set(targets)]
}

function resolveRceditPath(projectRoot = process.cwd()): string {
	const candidates = [
		resolve(projectRoot, "node_modules", "rcedit", "bin", "rcedit-x64.exe"),
		resolve(projectRoot, "node_modules", "rcedit", "bin", "rcedit.exe"),
	]

	const rceditPath = firstExisting(candidates, existsSync)
	if (!rceditPath) {
		throw new Error(`Unable to find rcedit under ${resolve(projectRoot, "node_modules", "rcedit")}`)
	}

	return rceditPath
}

function powershellQuote(value: string): string {
	return `'${value.replace(/'/g, "''")}'`
}

function createInstallerZipFromPatchedExe(options: {
	buildDir: string
	artifactDir: string
	appName: string
	buildEnvironment?: string
	electrobunOs?: string
	arch?: string
}): void {
	const setupName = `${options.appName}-Setup`
	const installerExe = join(options.buildDir, `${setupName}.exe`)
	const metadata = join(options.buildDir, `${setupName}.metadata.json`)
	const archive = join(options.buildDir, `${setupName}.tar.zst`)

	if (!existsSync(installerExe) || !existsSync(metadata) || !existsSync(archive)) {
		return
	}

	const artifactCandidates: string[] = []
	if (options.buildEnvironment && options.electrobunOs && options.arch) {
		artifactCandidates.push(
			join(
				options.artifactDir,
				`${options.buildEnvironment}-${options.electrobunOs}-${options.arch}-${setupName}.zip`,
			),
		)
	}

	if (existsSync(options.artifactDir)) {
		for (const entry of readdirSync(options.artifactDir)) {
			if (entry.endsWith(`${setupName}.zip`)) {
				artifactCandidates.push(join(options.artifactDir, entry))
			}
		}
	}

	const zipTargets = [...new Set(artifactCandidates)].filter(existsSync)
	if (zipTargets.length === 0) {
		return
	}

	const stagingDir = join(options.buildDir, ".agenthub-icon-patch-installer")
	const installerDir = join(stagingDir, ".installer")

	rmSync(stagingDir, { recursive: true, force: true })
	mkdirSync(installerDir, { recursive: true })

	try {
		copyFileSync(installerExe, join(stagingDir, basename(installerExe)))
		copyFileSync(metadata, join(installerDir, basename(metadata)))
		copyFileSync(archive, join(installerDir, basename(archive)))

		for (const zipPath of zipTargets) {
			mkdirSync(dirname(zipPath), { recursive: true })
			const command = [
				"-NoProfile",
				"-Command",
				`Compress-Archive -Path ${powershellQuote(join(stagingDir, "*"))} -DestinationPath ${powershellQuote(zipPath)} -Force`,
			]
			execFileSync("powershell.exe", command, { stdio: "inherit" })
			console.log(`Rebuilt Windows installer zip with patched icon: ${zipPath}`)
		}
	} finally {
		rmSync(stagingDir, { recursive: true, force: true })
	}
}

function patchWindowsIcons(): void {
	if (process.platform !== "win32") {
		console.log("AgentHub Windows icon patch skipped on non-Windows host.")
		return
	}

	const projectRoot = process.cwd()
	const iconPath = resolve(projectRoot, "assets", "icon.ico")
	if (!existsSync(iconPath)) {
		throw new Error(`Missing AgentHub icon: ${iconPath}`)
	}

	const rceditPath = resolveRceditPath(projectRoot)
	const targets = resolveWindowsIconPatchTargets()
	for (const target of targets) {
		const [command, ...args] = createRceditCommand(rceditPath, target, iconPath)
		console.log(`Embedding AgentHub icon into ${target}`)
		execFileSync(command, args, { stdio: "inherit" })
	}

	const buildDir = process.env.ELECTROBUN_BUILD_DIR?.trim()
	const artifactDir = process.env.ELECTROBUN_ARTIFACT_DIR?.trim()
	const appName = process.env.ELECTROBUN_APP_NAME?.trim()
	if (buildDir && artifactDir && appName) {
		createInstallerZipFromPatchedExe({
			buildDir,
			artifactDir,
			appName,
			buildEnvironment: process.env.ELECTROBUN_BUILD_ENV?.trim(),
			electrobunOs: process.env.ELECTROBUN_OS?.trim(),
			arch: process.env.ELECTROBUN_ARCH?.trim(),
		})
	}
}

if (import.meta.main) {
	patchWindowsIcons()
}
