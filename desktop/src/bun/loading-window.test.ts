import { describe, expect, it } from "bun:test"
import { createLoadingWindowHtml } from "./loading-window"

describe("Desktop loading window", () => {
	it("renders a lightweight startup page before HubServer is ready", () => {
		const html = createLoadingWindowHtml()

		expect(html).toContain("Starting AgentHub")
		expect(html).toContain("background:")
		expect(html).not.toContain("http://127.0.0.1")
	})
})
