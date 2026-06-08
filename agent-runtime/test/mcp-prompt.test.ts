import { describe, expect, test } from "bun:test"
import { formatMcpContextForPrompt, type McpRuntimeContext } from "../src/runtime"

describe("MCP prompt block", () => {
  test("summarizes connected MCP servers and tools without leaking internal paths", () => {
    const block = formatMcpContextForPrompt({
      servers: [
        {
          id: "workspace:opencode:opencode.json:docs",
          name: "docs",
          source: "opencode",
          transport: "stdio",
          status: "connected",
          toolCount: 1,
        },
      ],
      tools: [
        {
          toolName: "mcp_docs_search",
          serverId: "workspace:opencode:opencode.json:docs",
          serverName: "docs",
          mcpToolName: "search",
          description: "Search docs",
        },
      ],
      toolDefinitions: [],
    } satisfies McpRuntimeContext)

    expect(block).toContain("Workspace MCP tools")
    expect(block).toContain("docs")
    expect(block).toContain("mcp_docs_search")
    expect(block).toContain("Search docs")
    expect(block).not.toContain("D:\\")
    expect(block).not.toContain("rootPath")
  })

  test("returns empty string when no MCP tools are available", () => {
    expect(formatMcpContextForPrompt({
      servers: [],
      tools: [],
      toolDefinitions: [],
    })).toBe("")
  })
})
