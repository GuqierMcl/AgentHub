# Image Messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users send image messages, persist uploaded image copies under HubServer user data, render image messages in chat, and pass image parts to Runtime model messages consistently.

**Architecture:** HubServer owns image asset ingestion and serves conversation-scoped asset URLs from `config.dataDir`. Messages persist text and image parts in `MessagePart`; Web renders those parts with existing ai-elements attachment components. Runtime keeps a compatible string `content` field but adds typed content parts, and AI SDK executors always build multimodal `ModelMessage` content when image parts exist, letting provider/model errors surface normally.

**Tech Stack:** TypeScript, Bun, Hono, Zod, Prisma repository layer, React, Vite, ai-elements `PromptInput` and `Attachments`, AI SDK `ModelMessage`.

---

## Decisions

- Uploaded user images are first copied into HubServer user data storage. Later display, message replay, Runtime input assembly, and model packaging reference that copied asset, not browser blob URLs or original client paths.
- Use `config.dataDir` as the repository's current user data directory. Store conversation images under `config.dataDir/conversation-assets/{conversationId}/images/{assetId}/`.
- Initial accepted image types: `image/png`, `image/jpeg`, `image/webp`, and `image/gif`. Reject `image/svg+xml` in this phase.
- Initial limits: max 8 images per message, max 10 MB per image.
- Do not branch on `supports_vision` before sending image parts to AI SDK models. If a selected provider/model rejects image input, let the existing Runtime error path surface the failure.
- Keep `RuntimeMessage.content: string` for compatibility and add optional typed `parts`; image-only messages use `content: ""` plus image parts.
- External agent adapters that cannot natively accept image parts should fail with a clear structured Runtime error in this phase rather than silently dropping images.

## Files

- Modify: `docs/architecture/DATA_MODEL.md`
- Modify: `docs/architecture/WEB.md`
- Modify: `docs/architecture/HUB_SERVER.md`
- Modify: `docs/contracts/AGENT_RUNTIME_API_CONTRACTS.md`
- Create: `hub-server/src/services/conversation-image-assets.service.ts`
- Create: `hub-server/src/services/conversation-image-assets.service.test.ts`
- Create: `hub-server/src/routers/conversation-assets.ts`
- Create: `hub-server/src/routers/conversation-assets.test.ts`
- Modify: `hub-server/src/routers/index.ts`
- Modify: `hub-server/src/routers/messages.ts`
- Modify: `hub-server/src/routers/messages.test.ts`
- Modify: `hub-server/src/services/run-persistence.service.ts`
- Modify: `hub-server/src/services/run-persistence.service.test.ts`
- Modify: `web/src/features/workbench/types.ts`
- Modify: `web/src/features/workbench/api/messages.ts`
- Modify: `web/src/features/workbench/components/ChatComposer.tsx`
- Modify: `web/src/features/workbench/components/ChatPanel.tsx`
- Modify: `web/src/features/workbench/components/WorkbenchContentLayout.tsx`
- Modify: `web/src/features/workbench/runtime/timeline-projection.ts`
- Modify: `web/src/features/workbench/runtime/timeline-projection.test.ts`
- Modify: `web/src/features/workbench/components/MessageItem.tsx`
- Modify: `web/src/features/workbench/components/MessageItem.test.tsx`
- Modify: `agent-runtime/src/runtime/types.ts`
- Modify: `agent-runtime/src/runtime/ai-sdk-executor.ts`
- Modify: `agent-runtime/src/runtime/orchestrator-executor.ts`
- Modify: `agent-runtime/src/runtime/external-adapters/opencode-adapter.ts`
- Modify: `agent-runtime/src/runtime/external-adapters/claude-code-adapter.ts`
- Modify: `agent-runtime/src/runtime/external-adapters/codex-adapter.ts`
- Create: `agent-runtime/test/runtime-multimodal-messages.test.ts`
- Modify: `agent-runtime/test/external-adapter.test.ts`

## Message And Asset Shapes

HubServer message send body:

```ts
type SendMessageBody = {
  content?: string
  addressedAgentIds?: string[]
  replyToMessageId?: string
  attachments?: Array<{
    kind: "image"
    assetId: string
  }>
}
```

Persisted image part payload:

```ts
type PersistedImageAttachmentPart = {
  kind: "image"
  assetId: string
  filename: string
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"
  size: number
  width?: number
  height?: number
  url: string
}
```

Runtime message content parts:

```ts
type RuntimeMessagePart =
  | { type: "text"; text: string }
  | {
      type: "image"
      mediaType: string
      filename?: string
      data: string
      encoding: "base64"
    }

type RuntimeMessage = {
  id?: string
  role: "user" | "assistant" | "system"
  agentId?: string
  content: string
  parts?: RuntimeMessagePart[]
}
```

## Task 1: Document Contracts

**Files:**
- Modify: `docs/architecture/DATA_MODEL.md`
- Modify: `docs/architecture/WEB.md`
- Modify: `docs/architecture/HUB_SERVER.md`
- Modify: `docs/contracts/AGENT_RUNTIME_API_CONTRACTS.md`

- [x] Add a DATA_MODEL subsection that defines text + image `MessagePart` ordering: text part uses `partKey="text"` when present; image parts use `partKey="image:{assetId}"`; image-only messages are valid.
- [x] Add a HUB_SERVER subsection that records `config.dataDir/conversation-assets/{conversationId}/images/{assetId}/` as the only persisted image source.
- [x] Add a WEB subsection that says composer files must be uploaded before message send, and persisted message rendering uses returned asset URLs.
- [x] Update Runtime contracts so `RuntimeMessage` keeps `content: string` and adds optional `parts`.
- [x] Record that Runtime AI SDK execution does not preflight `supports_vision`; provider/model errors remain terminal Run errors.
- [x] Run `git diff -- docs/architecture/DATA_MODEL.md docs/architecture/WEB.md docs/architecture/HUB_SERVER.md docs/contracts/AGENT_RUNTIME_API_CONTRACTS.md` and confirm the contract matches the decisions above.

## Task 2: HubServer Image Asset Service

**Files:**
- Create: `hub-server/src/services/conversation-image-assets.service.ts`
- Create: `hub-server/src/services/conversation-image-assets.service.test.ts`

- [x] Write tests for successful PNG upload, rejected SVG upload, rejected oversized upload, metadata manifest writing, and read-back by `assetId`.
- [x] Implement constants:

```ts
export const CONVERSATION_IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const CONVERSATION_IMAGE_MAX_PER_MESSAGE = 8
export const CONVERSATION_IMAGE_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const
```

- [x] Implement `saveConversationImageAsset(input)` that accepts `{ conversationId, fileName, mediaType, bytes }`, validates size and media type, inspects dimensions with `sharp.metadata()`, writes `original.{ext}` plus `metadata.json`, and returns `{ assetId, filename, mediaType, size, width, height, relativePath, url }`.
- [x] Implement `getConversationImageAsset(conversationId, assetId)` that reads `metadata.json`, resolves the file path under `config.dataDir`, verifies the resolved path stays inside the asset directory, and returns stream metadata for Hono.
- [x] Run `cd hub-server && bun test src/services/conversation-image-assets.service.test.ts`.

## Task 3: HubServer Asset Router

**Files:**
- Create: `hub-server/src/routers/conversation-assets.ts`
- Create: `hub-server/src/routers/conversation-assets.test.ts`
- Modify: `hub-server/src/routers/index.ts`

- [x] Add `POST /api/conversations/:conversationId/assets/images` using `c.req.parseBody()`, expecting multipart field `file`.
- [x] Validate the conversation exists before writing an asset.
- [x] Return the persisted asset metadata and URL from `saveConversationImageAsset`.
- [x] Add `GET /api/conversations/:conversationId/assets/images/:assetId/file` that streams the copied image with `Content-Type` and `Cache-Control: private, max-age=31536000, immutable`.
- [x] Register the router in `hub-server/src/routers/index.ts`.
- [x] Run `cd hub-server && bun test src/routers/conversation-assets.test.ts`.

## Task 4: HubServer Message Persistence And Runtime Input

**Files:**
- Modify: `hub-server/src/routers/messages.ts`
- Modify: `hub-server/src/routers/messages.test.ts`
- Modify: `hub-server/src/services/run-persistence.service.ts`
- Modify: `hub-server/src/services/run-persistence.service.test.ts`

- [x] Extend `SendMessageBodySchema` to accept optional `content` and optional image `attachments`, while requiring at least one non-empty text or one image.
- [x] Extend `RunPersistenceService.sendMessage` options to include `attachments`.
- [x] Validate each `assetId` by reading its manifest through the image asset service before creating the message.
- [x] Persist a text part only when trimmed text is non-empty.
- [x] Persist each image as `MessagePart(type="image", partKey="image:{assetId}", payloadJson=imageMetadata)`.
- [x] Make image-only messages valid in last-message preview, reply excerpt, and regenerate source checks; use `[图片]` for one image and `[N 张图片]` for multiple images when no text exists.
- [x] Extend history projection so Runtime history contains `parts` for user image messages.
- [x] When building current Run input, read each copied image file from user data storage and encode it as base64 image parts in `RuntimeMessage.parts`.
- [x] Run `cd hub-server && bun test src/routers/messages.test.ts src/services/run-persistence.service.test.ts`.

## Task 5: Web Upload And Send Flow

**Files:**
- Modify: `web/src/features/workbench/types.ts`
- Modify: `web/src/features/workbench/api/messages.ts`
- Modify: `web/src/features/workbench/components/ChatComposer.tsx`
- Modify: `web/src/features/workbench/components/ChatPanel.tsx`
- Modify: `web/src/features/workbench/components/WorkbenchContentLayout.tsx`

- [x] Add `ChatImageAttachmentInput` and `ChatImageAttachment` types.
- [x] Add `conversationMessagesApi.uploadImage(conversationId, filePart)` that converts the `FileUIPart.url` data URL to a `Blob`, posts multipart `FormData`, and returns HubServer asset metadata.
- [x] Extend `conversationMessagesApi.send` to include `attachments`.
- [x] Pass `message.files` from `ChatComposer.handleSubmit` instead of dropping them.
- [x] Allow submit when `content.trim()` is empty but files exist.
- [x] In `WorkbenchContentLayout.handleSubmit`, upload images first, then call `conversationMessagesApi.send` with returned `assetId`s.
- [x] On upload failure, append a local failed timeline item with the server error message and do not send the chat message.
- [x] Run `cd web && bunx tsc --noEmit -p tsconfig.app.json`.

## Task 6: Web Timeline And Message Rendering

**Files:**
- Modify: `web/src/features/workbench/types.ts`
- Modify: `web/src/features/workbench/runtime/timeline-projection.ts`
- Modify: `web/src/features/workbench/runtime/timeline-projection.test.ts`
- Modify: `web/src/features/workbench/components/MessageItem.tsx`
- Modify: `web/src/features/workbench/components/MessageItem.test.tsx`

- [x] Add `attachments?: WorkbenchMessageAttachment[]` to `WorkbenchTimelineChatMessageItem`.
- [x] Extend local optimistic user items to include image attachments after upload metadata is available.
- [x] Extend persisted message hydration to read `MessagePart(type="image")` payloads.
- [x] Render image attachments with ai-elements `Attachments`, `Attachment`, `AttachmentPreview`, `AttachmentContent`, and `AttachmentName` inside the message bubble below text.
- [x] Keep reply previews and conversation previews text-friendly with `[图片]` fallback.
- [x] Add tests for image-only message hydration, text+image rendering, and reply excerpt fallback.
- [x] Run `cd web && bunx tsc --noEmit -p tsconfig.app.json`.

## Task 7: Runtime Multimodal Contract And AI SDK Mapping

**Files:**
- Modify: `agent-runtime/src/runtime/types.ts`
- Modify: `agent-runtime/src/runtime/ai-sdk-executor.ts`
- Modify: `agent-runtime/src/runtime/orchestrator-executor.ts`
- Create: `agent-runtime/test/runtime-multimodal-messages.test.ts`

- [x] Add `RuntimeMessagePartSchema` for `text` and `image` parts.
- [x] Change `RuntimeMessageSchema` to keep `content: z.string()` and add `parts: z.array(RuntimeMessagePartSchema).optional()`.
- [x] Add a helper such as `toModelMessageContent(message)` that returns a string when no image parts exist, otherwise returns an AI SDK content array containing text and image parts.
- [x] Use the helper in `ai-sdk-executor.ts` and `orchestrator-executor.ts` for both history and current user message.
- [x] Do not inspect `resolvedModel.capabilities.supports_vision` in this helper.
- [x] Add tests proving image parts become `ModelMessage.content` arrays even when no capability flag is checked.
- [x] Run `cd agent-runtime && bun test test/runtime-multimodal-messages.test.ts`.

## Task 8: External Adapter Error Behavior

**Files:**
- Modify: `agent-runtime/src/runtime/external-adapters/opencode-adapter.ts`
- Modify: `agent-runtime/src/runtime/external-adapters/claude-code-adapter.ts`
- Modify: `agent-runtime/src/runtime/external-adapters/codex-adapter.ts`
- Modify: `agent-runtime/test/external-adapter.test.ts`

- [x] Add a shared guard in each external adapter entry path: if `context.input.userMessage.parts` contains an image part, throw a structured error before invoking the external process.
- [x] Use a stable code: `MULTIMODAL_NOT_SUPPORTED_BY_ADAPTER`.
- [x] Include provider id and image count in sanitized error details; do not include base64 image data.
- [x] Add tests that image messages fail clearly for OpenCode, Claude Code, and Codex adapters instead of silently dropping attachments.
- [x] Run `cd agent-runtime && bun test test/external-adapter.test.ts`.

## Task 9: End-To-End Verification

**Files:**
- All files touched above.

- [x] Run HubServer targeted checks:

```bash
cd hub-server && bun test src/services/conversation-image-assets.service.test.ts src/routers/conversation-assets.test.ts src/routers/messages.test.ts src/services/run-persistence.service.test.ts
```

- [x] Run Runtime targeted checks:

```bash
cd agent-runtime && bun test test/runtime-multimodal-messages.test.ts test/external-adapter.test.ts
```

- [x] Run Web type check:

```bash
cd web && bunx tsc --noEmit -p tsconfig.app.json
```

- [x] Smoke test with dev servers: real HubServer + Runtime HTTP smoke uploaded a PNG, sent an image-only message, read persisted image parts and the HubServer asset URL, confirmed `[图片]` preview, and confirmed a Codex image-only run fails with `MULTIMODAL_NOT_SUPPORTED_BY_ADAPTER` instead of dropping the image. Visual browser click/refresh was not run in this environment; Web attachment hydration/rendering was covered by focused component/store tests.

## Self-Review

- Coverage: The plan covers HubServer user-data asset copies, message part persistence, Web send/display, Runtime multimodal packaging, adapter error behavior, docs, and verification.
- Placeholder scan: No task uses TBD/TODO placeholders.
- Type consistency: Hub message attachments use `kind: "image"` and Runtime model parts use `type: "image"` consistently.
- Review fixes: Added HubServer upload `bodyLimit` so oversized multipart uploads fail before full parsing, kept composer draft/files when upload or send fails, and constrained client uploads to PNG/JPEG/WebP/GIF with the same 10 MB and 8-image limits.
- Runtime payload risk: Current Runtime run input sends copied image bytes as base64 image parts and the HubServer run snapshot may contain that full payload. This preserves first-pass behavior but can grow request and persistence size quickly when image history is replayed. Follow up with sanitized persisted run inputs and/or bounded image-history replay.
- Residual maintenance: Uploaded-but-unsent image assets are not yet cleaned up by TTL or ownership reconciliation. This is acceptable for the first image-message pass but should become a follow-up storage hygiene task.
