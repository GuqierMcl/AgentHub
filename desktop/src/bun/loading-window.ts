function escapeHtmlAttribute(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
}

export function createLoadingWindowHtml(iconUrl?: string): string {
	const mark = iconUrl
		? `<img class="mark" src="${escapeHtmlAttribute(iconUrl)}" alt="AgentHub">`
		: `<div class="mark" aria-hidden="true"></div>`

	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>AgentHub</title>
	<style>
		:root {
			color-scheme: light dark;
			font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
			background: #111827;
			color: #f9fafb;
		}
		body {
			margin: 0;
			min-height: 100vh;
			display: grid;
			place-items: center;
			background: #111827;
		}
		main {
			width: min(320px, calc(100vw - 48px));
			display: grid;
			gap: 14px;
			text-align: center;
		}
		.mark {
			width: 42px;
			height: 42px;
			margin: 0 auto;
			border-radius: 10px;
			background: #22c55e;
			object-fit: cover;
			box-shadow: 0 0 0 1px rgb(255 255 255 / 0.08), 0 18px 44px rgb(34 197 94 / 0.24);
		}
		h1 {
			margin: 0;
			font-size: 18px;
			font-weight: 650;
			letter-spacing: 0;
		}
		p {
			margin: 0;
			color: #cbd5e1;
			font-size: 13px;
			line-height: 1.5;
		}
		.progress {
			height: 3px;
			overflow: hidden;
			border-radius: 999px;
			background: rgb(255 255 255 / 0.12);
		}
		.progress::before {
			content: "";
			display: block;
			width: 42%;
			height: 100%;
			border-radius: inherit;
			background: #22c55e;
			animation: slide 1.1s ease-in-out infinite;
		}
		@keyframes slide {
			0% { transform: translateX(-110%); }
			100% { transform: translateX(260%); }
		}
	</style>
</head>
<body>
	<main>
		${mark}
		<h1>Starting AgentHub</h1>
		<p>Preparing local services...</p>
		<div class="progress" aria-hidden="true"></div>
	</main>
</body>
</html>`
}
