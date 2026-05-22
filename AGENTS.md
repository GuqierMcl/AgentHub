# AGENTS.md - Agent Coding Guidelines for AgentHub

This file provides guidance for AI agents operating in this repository.

---

## 0. Documentation Authority

- Agent behavior, feature design, architecture decisions, and implementation details must be constrained by the repository documentation in `docs/`.
- Before each development round, read the relevant design document(s) in `docs/` first. If no matching document exists, create or update the closest documentation entry before or alongside implementation.
- If implementation and documentation disagree, do not silently choose one. Tell the user what is stale or inconsistent, explain the impact briefly, and ask whether the documentation should be revised.
- When a change intentionally updates behavior, contracts, module boundaries, architecture, permissions, orchestration, or artifact protocols, update the matching docs in the same work batch unless the user explicitly says not to.
- Keep documentation practical and current. Prefer concise specs, API contracts, ADRs, and module notes that future agents can use directly.

---

## 1. Repository Structure

AgentHub is a multi-agent collaboration platform built around IM-style interaction.

```
AgentHub/
├── web/              # React + Vite frontend
├── hub-server/       # Node/Bun + Hono platform backend
├── agent-runtime/    # Node/Bun + Hono agent sidecar runtime
├── docs/             # Product, architecture, contracts, and ADRs
└── .agents/          # Local agent skills and tool references
```

### `web/`

- Provides the web client and primary user experience.
- Owns IM-style UI: conversation list, single-agent chats, group chats, message stream, artifacts, previews, and editing entry points.
- Development runs with `cd web && bun dev`.
- Production web assets are expected to be integrated into `hub-server` and exposed through the web port.
- Future migration to an Electron client should preserve web app boundaries and avoid coupling UI directly to local-only capabilities.

### `hub-server/`

- Provides platform APIs using Node/Bun + Hono.
- Owns user-facing backend concerns such as sessions, conversations, messages, agent registry, artifact metadata, and web asset hosting.
- Acts as the single backend entry point from `web`.
- Communicates with `agent-runtime` for AI execution and orchestration.

### `agent-runtime/`

- Runs as a **Sidecar process** for the AgentHub application (Web + HubServer).
- In production, HubServer automatically spawns agent-runtime at startup and manages its lifecycle (health check, auto-restart, graceful shutdown).
- In development, agent-runtime can be started independently for debugging and hot-reload.
- Owns all AI execution concerns: LLM calls, external agent adapters, orchestration, tool calls, permissions, sandbox policy, and artifact generation.
- The frontend must not call LLM providers directly or hold LLM credentials.
- External agent integrations such as Claude Code, Codex, OpenCode, and custom agents must go through this layer.
- See `docs/adr/ADR-001-sidecar-architecture.md` for architectural decision.

---

## 2. Runtime Boundaries

- Required flow: `web -> hub-server -> agent-runtime`.
- `web` should call `hub-server` APIs only.
- `hub-server` should coordinate product state and delegate AI execution to `agent-runtime`.
- `agent-runtime` is a Sidecar process managed by `hub-server` (see `docs/adr/ADR-001-sidecar-architecture.md`).
- `agent-runtime` should expose controlled runtime APIs to `hub-server`, not directly to browser UI.
- LLM credentials, provider adapters, command execution, file access, deployment, and network-sensitive operations belong in `agent-runtime`.
- When adding or changing cross-process behavior, update `docs/contracts/API_CONTRACTS.md` and the relevant architecture doc.

---

## 3. Build, Test, and Run Commands

Use Bun for JavaScript/TypeScript package execution in this repository.

### Root

```bash
bun run dev:web
bun run dev:server
```

### Web

```bash
cd web && bun dev
cd web && bun run lint
cd web && bunx tsc --noEmit -p tsconfig.app.json
```

### Hub Server

```bash
cd hub-server && bun dev
```

### Agent Runtime

```bash
cd agent-runtime && bun dev
```

`agent-runtime` may not have its runnable scaffold yet. When implementing it, add a local `package.json` and document the commands in `docs/architecture/AGENT_RUNTIME.md`.

Note: In production, agent-runtime is automatically started by hub-server as a Sidecar process. The `bun dev` command is for development/debugging only.

### Verification Policy

- At the end of each coding task, prefer lightweight checks: type checks, lint, focused tests, API smoke tests, or targeted runtime checks.
- Avoid `build` commands by default because they are heavier in time and resources.
- Use build commands only when the user asks, when preparing release verification, or when the changed behavior cannot be validated responsibly without a build.
- If a relevant test command does not exist yet, note that clearly and add a focused one when the task justifies it.

---

## 4. Product Priorities

### P0

- IM-style chat shell.
- Conversation list and multi-session workflow.
- Single-agent conversation.
- Basic message stream and persisted context.

### P1

- Group chat with multiple agents.
- Orchestrator task splitting and aggregation.
- At least two external agent adapters.
- Inline artifact cards for code, web preview, files, and diff-like outputs.

### P2

- Diff view and one-click apply.
- Version history.
- Conversational local edits.
- Deployment status cards and publish flow.
- Desktop and mobile extensions.

Keep implementation MVP-first. Complete the core chat-to-agent loop before polishing secondary surfaces.

---

## 5. Code Style Guidelines

- Use TypeScript for app, server, and runtime code.
- Prefer explicit function parameter and return types on exported functions and API boundaries.
- Keep module boundaries aligned with `web`, `hub-server`, and `agent-runtime`; do not move responsibilities across layers without updating docs first.
- Keep API request/response contracts synchronized across caller and callee.
- Prefer small, focused changes over broad refactors.
- Follow existing local patterns before introducing new abstractions.
- Use structured parsers and typed data models for contracts instead of ad hoc string manipulation.
- Do not introduce unrelated formatting churn.

### Frontend

- Build the actual product surface first, not a landing page.
- Use the repository's existing React, Vite, Tailwind, and shadcn conventions.
- For AI chat UI, prefer the local `ai-elements` skill/components when they fit the task.
- Keep the IM experience dense, usable, and product-oriented: conversation list, message flow, input, agent identity, artifacts, and preview actions should be first-class.

### Backend and Runtime

- Use Hono idioms for routing and middleware.
- Validate inputs at API boundaries.
- Return structured errors with stable codes where practical.
- Keep `hub-server` product APIs separate from `agent-runtime` execution APIs.
- Runtime adapters should normalize provider-specific behavior behind a common interface.

---

## 6. Security, Permissions, and Sandbox Rules

- The browser must not store or directly use LLM provider credentials.
- Tool execution, file access, command execution, deployment, and external network calls must be mediated by `agent-runtime` permission checks.
- Destructive or sensitive operations should require an explicit approval path in product design.
- Agent adapters must declare their capabilities, required permissions, and artifact types.
- Sandbox policy changes must be documented in `docs/architecture/AGENT_RUNTIME.md`.

---

## 7. Documentation Index

Start with these docs before changing the matching area:

| Document | Purpose |
| --- | --- |
| `docs/README.md` | Documentation map and update rules |
| `docs/product/PRODUCT_SPEC.md` | Product scope, priorities, and user experience |
| `docs/architecture/ARCHITECTURE.md` | Overall system architecture and process boundaries |
| `docs/architecture/DATA_MODEL.md` | Domain data model and AI SDK message modeling |
| `docs/architecture/WEB.md` | Frontend architecture and UI rules |
| `docs/architecture/HUB_SERVER.md` | Platform backend responsibilities and APIs |
| `docs/architecture/AGENT_RUNTIME.md` | Agent runtime, orchestration, adapters, permissions, sandbox |
| `docs/contracts/API_CONTRACTS.md` | Cross-process API contracts and event payloads |
| `docs/reference/HONO.md` | Shared Hono usage conventions for backend services |
| `docs/roadmap/` | Long-running implementation paths for complex modules |
| `docs/adr/` | Architecture decision records |

If a task changes a behavior that does not fit an existing document, create a focused doc or ADR instead of leaving the decision implicit.

---

## 8. AI Collaboration Records

- Record important AI-assisted decisions, major spec changes, adapter designs, and orchestration rules in `docs/`.
- Use ADRs for choices that affect architecture or future maintenance.
- Use `docs/roadmap/` for long-running, multi-session implementation plans of complex modules.
- Keep records concise: context, decision, consequences, and follow-up work.
- When a prompt/spec/rule becomes reusable, turn it into documentation or a skill rather than burying it in chat history.

---

## 9. Roadmap Workflow

- For any long, complex module, create or open a matching roadmap file in `docs/roadmap/` before coding.
- Read the roadmap at the start of each later session or chat turn that continues the same module.
- Update the roadmap whenever phase boundaries, scope, risks, or progress change.
- Keep roadmap entries focused on execution path, checkpoints, and next actions.
- If a roadmap is missing for a task that clearly needs one, create it instead of relying on chat history.

---

## 10. Agent Workflow Checklist

Before coding:

- Read the relevant `docs/` entries.
- Identify which layer owns the change: `web`, `hub-server`, `agent-runtime`, or docs.
- Check whether API contracts or runtime permissions are affected.

During coding:

- Keep changes scoped.
- Preserve existing user work and unrelated files.
- Update docs when behavior, contracts, or architecture changes.

Before finishing:

- Run lightweight verification where available.
- Avoid build commands unless specifically justified.
- Summarize code changes, docs changes, and verification results.
