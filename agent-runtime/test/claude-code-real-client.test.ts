import { describe, expect, test } from "bun:test"
import { execFile } from "node:child_process"
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import {
  RealClaudeCodeClient,
  WorkspaceDiffService,
  WorkspaceService,
  type ClaudeCodePromptEvent,
  type NormalizedQuestionAnswer,
} from "../src/runtime"
import { convertClaudeCodeSdkMessagesForTest } from "../src/runtime/external-adapters/claude-code-real-client"

const execFileAsync = promisify(execFile)
const claudeCodeSmokeTest = process.env.AGENTHUB_CLAUDE_CODE_SMOKE === "1" ? test : test.skip
const claudeCodeWriteSmokeTest = process.env.AGENTHUB_CLAUDE_CODE_WRITE_SMOKE === "1" ? test : test.skip

async function createGitWorkspace(): Promise<{
  workspaceRoot: string
  workspaceService: WorkspaceService
  cleanup: () => Promise<void>
}> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-runtime-claude-code-write-smoke-"))
  await writeFile(join(workspaceRoot, "README.md"), "AgentHub Claude Code smoke workspace\n", "utf8")
  await runGit(workspaceRoot, ["init"])
  await runGit(workspaceRoot, ["config", "user.email", "agenthub@example.local"])
  await runGit(workspaceRoot, ["config", "user.name", "AgentHub Test"])
  await runGit(workspaceRoot, ["add", "."])
  await runGit(workspaceRoot, ["commit", "-m", "initial"])
  return {
    workspaceRoot,
    workspaceService: new WorkspaceService({
      workdir: workspaceRoot,
      workspaceId: "workspace_claude_code_write_smoke",
      runId: "run_claude_code_write_smoke",
    }),
    cleanup: () => rm(workspaceRoot, { recursive: true, force: true }),
  }
}

async function runGit(workspaceRoot: string, args: string[]): Promise<void> {
  await execFileAsync("git", ["-C", workspaceRoot, ...args], {
    encoding: "utf8",
    windowsHide: true,
  })
}

function createSmokeAbortSignal(timeoutMs = 120_000): {
  signal: AbortSignal
  clear: () => void
} {
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Claude Code smoke timed out after ${timeoutMs}ms`))
  }, timeoutMs)
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  }
}

function answerFirstOption(questions: { id?: string; options: Array<{ id?: string }> }[]): NormalizedQuestionAnswer[] {
  return questions.map((question, index) => ({
    questionId: question.id ?? `question_${index + 1}`,
    optionId: question.options[0]?.id,
    answer: question.options[0]?.id ?? "Proceed",
    custom: false,
  }))
}

describe("Claude Code SDK event mapping", () => {
  test("assembles streamed tool input deltas and preserves tool result content", () => {
    const events = convertClaudeCodeSdkMessagesForTest([
      {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "toolu_edit",
            name: "Edit",
            input: {},
          },
        },
      },
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "input_json_delta",
            partial_json: "{\"file_path\":\"src/index.ts\",",
          },
        },
      },
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "input_json_delta",
            partial_json: "\"new_string\":\"updated\"}",
          },
        },
      },
      {
        type: "user",
        parent_tool_use_id: null,
        message: {
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: "toolu_edit",
            content: "Updated src/index.ts",
          }],
        },
      },
    ])

    const startedEvents = events.filter((event) => event.type === "tool.started")
    const completed = events.find((event) => event.type === "tool.completed")

    expect(startedEvents).toHaveLength(2)
    expect(startedEvents.at(-1)).toMatchObject({
      providerToolCallId: "toolu_edit",
      providerToolName: "Edit",
      input: {
        file_path: "src/index.ts",
        new_string: "updated",
      },
    })
    expect(completed).toMatchObject({
      providerToolCallId: "toolu_edit",
      providerToolName: "Edit",
      input: {
        file_path: "src/index.ts",
        new_string: "updated",
      },
      output: "Updated src/index.ts",
    })
  })
})

describe("Claude Code optional smoke tests", () => {
  claudeCodeSmokeTest("runs a real direct Claude Code prompt using the user's configured account", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-runtime-claude-code-prompt-smoke-"))
    const client = new RealClaudeCodeClient()
    const abort = createSmokeAbortSignal()

    try {
      const session = await client.ensureSession({
        runId: "run_claude_code_prompt_smoke",
        conversationId: "conv_claude_code_prompt_smoke",
        agentId: "claude-code",
        scope: "conversation-visible",
        workspaceId: "workspace_claude_code_prompt_smoke",
        workspaceRootPath: workspaceRoot,
      })
      const events: ClaudeCodePromptEvent[] = []
      for await (const event of client.streamPrompt({
        session,
        prompt: {
          scope: "conversation-visible",
          content: "Reply with a short confirmation that Claude Code is connected.",
        },
        cwd: workspaceRoot,
        signal: abort.signal,
      })) {
        events.push(event)
      }

      expect(events.some((event) => event.type === "message.completed" && event.content.length > 0)).toBe(true)
    } finally {
      abort.clear()
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  claudeCodeWriteSmokeTest("runs a real Claude Code write prompt and records workspace diff", async () => {
    const { workspaceRoot, workspaceService, cleanup } = await createGitWorkspace()
    const diffService = new WorkspaceDiffService()
    const baseline = await diffService.captureBaseline(workspaceService)
    const client = new RealClaudeCodeClient()
    const targetFile = "agenthub-claude-code-smoke.txt"
    const targetContent = "AgentHub Claude Code write smoke"
    const abort = createSmokeAbortSignal()

    try {
      const session = await client.ensureSession({
        runId: "run_claude_code_write_smoke",
        conversationId: "conv_claude_code_write_smoke",
        agentId: "claude-code",
        scope: "conversation-visible",
        workspaceId: "workspace_claude_code_write_smoke",
        workspaceRootPath: workspaceRoot,
      })
      const events: ClaudeCodePromptEvent[] = []
      for await (const event of client.streamPrompt({
        session,
        prompt: {
          scope: "conversation-visible",
          content: [
            `Create a file named ${targetFile} in the current workspace.`,
            `The file content must include exactly this text: ${targetContent}.`,
            "Reply briefly after the file is written.",
          ].join("\n"),
        },
        cwd: workspaceRoot,
        signal: abort.signal,
        permissionHandler: async () => ({ approved: true, reason: "Claude Code write smoke approval" }),
        questionHandler: async (request) => answerFirstOption(request.questions),
      })) {
        events.push(event)
      }

      const fileContent = await readFile(join(workspaceRoot, targetFile), "utf8")
      const summary = await diffService.summarize(workspaceService, baseline)

      expect(fileContent).toContain(targetContent)
      expect(events.some((event) => event.type === "message.completed" && event.content.length > 0)).toBe(true)
      expect(summary.changedFiles.some((file) => file.path === targetFile)).toBe(true)
      expect(summary.stats.filesChanged).toBeGreaterThan(0)
      expect(summary.patch?.text ?? "").toContain(targetContent)
    } finally {
      abort.clear()
      await cleanup()
    }
  })
})
