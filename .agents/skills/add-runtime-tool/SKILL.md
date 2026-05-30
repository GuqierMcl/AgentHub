---
name: add-runtime-tool
description: Add or modify AgentHub Agent Runtime tools safely. Use when Codex needs to implement, register, expose, test, or change Runtime Tools, Tool Catalog metadata, authoring options, required permissions, approval policies, Runtime tool events and SSE payloads, preset agent allowedTools, user custom agent tool availability, workspace/file tools, or file/shell/network/deploy tool boundaries in the AgentHub repository.
---

# Add Runtime Tool

## Grounding

Treat `docs/` as the source of truth. Before editing code, read the relevant docs in this order:

1. `docs/guides/ADDING_RUNTIME_TOOLS.md`
2. `docs/architecture/AGENT_TOOLS.md`
3. `docs/architecture/AGENT_RUNTIME.md`
4. `docs/architecture/AGENT_RUNTIME_BACKEND.md` when the tool touches files, workspace mounts, sandboxing, or scoped grants
5. `docs/contracts/RUNTIME_SSE_EVENTS.md` when the change affects RunEvent types, event fields, model stream diagnostics, reasoning, or message grouping
6. `docs/contracts/API_CONTRACTS.md` when the change affects public Runtime APIs, event payloads, errors, product APIs, or authoring options
7. `docs/architecture/RUN_PERSISTENCE_AND_STREAMING.md` when tool, permission, reasoning, or task events need HubServer persistence or product UI projection

If the docs and implementation disagree, stop and tell the user what is stale or inconsistent before choosing a side.

## Workflow

### 1. Define the tool boundary

Lock these decisions before implementation:

- Tool name using stable `snake_case`.
- Model-visible purpose and description.
- Zod input schema and structured `ToolExecutionResult` shape: `status`, `summary`, `data`, `error`.
- `riskLevel`: `low`, `medium`, or `high`.
- `approvalPolicy`: `never`, `contextual`, or `always`; define contextual triggers.
- `requiredPermissions`.
- Whether the tool is `internal`.
- Whether user custom agents may configure it.
- Whether events from this tool should attach to an assistant message, appear only in the raw event log, or require a HubServer/Web projection.

Default new tools to `configurableByUserAgent: false`. Do not make high-risk tools user-configurable without an explicit permission and approval design.

### 2. Implement through Runtime boundaries

Add or extend tool code under `agent-runtime/src/runtime/tools/`.

- Define the input schema with Zod.
- Return a structured tool result, not a bare string.
- Include `displayName`, `category`, `riskLevel`, `requiredPermissions`, `approvalPolicy`, and `configurableByUserAgent` in the `ToolDefinition`.
- Do not put agent allowlists in `ToolDefinition`.
- Route file, shell, network, deploy, or external-service access through the appropriate Runtime service/backend; do not bypass permission or sandbox boundaries inside a tool.
- Ensure execution enters through `RuntimeToolRegistry.executeTool()` so `tool.started`, `tool.completed`, and `tool.failed` are emitted consistently with `toolCallId`, `toolName`, and any current `messageId/messageIndex`.

For Orchestrator-only tools, set `internal: true` and expose the tool only by adding its name to `orchestrator.allowedTools`.

Current built-in Runtime Tools are `write_plan`, `run_task`, `ls`, `read_file`, `glob`, `grep`, `write_file`, and `edit_file`. Workspace tools are registered from `createWorkspaceTools()` and go through `WorkspaceService`; do not add direct `node:fs` access inside a tool.

### 3. Register and expose deliberately

After implementation:

- Register the tool in Runtime initialization or the default Runtime tool registry.
- Add the tool name to each intended preset agent's `allowedTools`.
- Keep user custom agent exposure driven by Tool Catalog metadata only.
- If `configurableByUserAgent: true`, ensure authoring metadata is complete and update `docs/contracts/API_CONTRACTS.md` plus tests for `GET /runtime/agents/authoring-options`.

The Tool Catalog is the single code source for tool risk, permissions, approval policy, and authoring metadata. Do not rebuild tool lists in routers, CRUD validation, or UI-support code. As of the current implementation, user custom agents may choose the non-internal workspace tools exposed by Tool Catalog, while `write_plan`, `run_task`, shell, network, and deploy tools must not be granted through user custom agent CRUD without a new documented design.

### 4. Preserve permission and event semantics

Evaluate all three gates:

- `agent.allowedTools` controls visibility.
- `agent.permissionPolicy` must cover the tool's `requiredPermissions`.
- `approvalPolicy` decides whether the current call needs approval.

Approval state belongs to Runtime permission flow, not agent configuration. Tools requiring approval must emit `permission.requested` before any `tool.started`; approved, denied, and cancelled paths must produce their terminal permission events and resume or terminate the same Run correctly.

Do not leak workspace roots, host absolute paths, grant targets, or authorization directories in normal tool events or successful tool results. File tools should report workspace-relative paths or `mounts/<mountId>/...` logical paths.

When a tool or permission event happens inside a model output context, preserve message identity:

- `tool.*` and `permission.*` events should carry the current `messageId`; `RunManager` assigns `messageIndex`.
- Consumers use `messageId/messageIndex` to group text, reasoning, tool, and permission events into the same assistant message.
- `run_task` tool events are raw trace and persistence facts, but product UI should prefer `task.*`, delegated agent output, and task summary instead of rendering `run_task` as a normal tool card.
- `model.stream.part` is diagnostic passthrough, not a replacement for stable `tool.*`, `permission.*`, `task.*`, `message.*`, or `reasoning.*` events. Raw provider chunks stay disabled unless diagnostics explicitly enable them.

### 5. Update docs when behavior changes

Update the matching docs in the same change whenever the tool changes:

- API contracts, event payloads, error codes, or authoring options.
- `docs/contracts/RUNTIME_SSE_EVENTS.md` for RunEvent type, field, message identity, reasoning, or diagnostics changes.
- Permission, sandbox, workspace, adapter, or approval behavior.
- Runtime architecture, module boundaries, orchestration, or artifact protocols.
- HubServer persistence/projection and Web timeline behavior when tool events should be visible outside raw RunEvent replay.

Prefer updating existing docs over creating new docs. Create a focused ADR only for decisions with long-term architectural impact.

## Test Checklist

Add focused tests for the changed behavior. For a new tool, cover at least:

- Invalid input returns `TOOL_INVALID_INPUT`.
- Missing `agent.allowedTools` returns `TOOL_NOT_ALLOWED`.
- Allowed agents can see and execute the tool.
- Insufficient `permissionPolicy` returns `TOOL_PERMISSION_DENIED`.
- `internal` tools are hidden from normal AI SDK tool injection.
- Approval tools emit `permission.requested` before `tool.started`.
- Approved, denied, and cancelled approval paths emit terminal events and resume or end correctly.
- Successful and failed executions emit terminal tool events.
- Tool and permission events inside model output carry stable `messageId/messageIndex` grouping.
- User-configurable tools appear in `authoring-options`; internal or disallowed tools do not.
- Workspace tools preserve sandbox, sensitive path, external grant, and path redaction behavior.
- HubServer/Web projection tests are updated when the product UI or persisted message parts should change.

Run lightweight verification from `agent-runtime`:

```bash
bunx tsc --noEmit
bun test
```

If the change only edits this skill, validate the skill instead:

```bash
python C:\Users\Guqier\.codex\skills\.system\skill-creator\scripts\quick_validate.py D:\PyWorkSpace\AgentHub\.agents\skills\add-runtime-tool
```
