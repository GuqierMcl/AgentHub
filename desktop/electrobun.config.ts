import type { ElectrobunConfig } from "electrobun";
import { readAgentHubVersion } from "../scripts/version";

const ELECTROBUN_BUILD_ENVS = new Set(["dev", "canary", "stable"]);
const buildEnvironmentArg =
	process.argv.find((arg) => arg.startsWith("--env="))?.split("=")[1] ?? "";
const buildEnvironment = ELECTROBUN_BUILD_ENVS.has(buildEnvironmentArg)
	? buildEnvironmentArg
	: "stable";
const isBuildCommand = process.argv.includes("build");
const desktopBuildMode =
	isBuildCommand && buildEnvironment !== "dev" ? "production" : "development";
const productionResourceCopy =
	desktopBuildMode === "production" ? { "../dist": "agenthub-runtime" } : undefined;
const appVersion = readAgentHubVersion();

export default {
	app: {
		name: "AgentHub",
		identifier: "dev.agenthub.desktop",
		version: appVersion,
	},
	build: {
		bun: {
			define: {
				"process.env.AGENTHUB_DESKTOP_BUILD_MODE": JSON.stringify(desktopBuildMode),
			},
		},
		copy: productionResourceCopy,
		mac: {
			bundleCEF: false,
			icons: "assets/icon.iconset",
		},
		linux: {
			bundleCEF: false,
			icon: "assets/icon.png",
		},
		win: {
			bundleCEF: false,
			icon: "assets/icon.ico",
		},
	},
} satisfies ElectrobunConfig;
