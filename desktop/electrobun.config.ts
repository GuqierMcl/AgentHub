import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "AgentHub",
		identifier: "dev.agenthub.desktop",
		version: "0.0.1",
	},
	build: {
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
