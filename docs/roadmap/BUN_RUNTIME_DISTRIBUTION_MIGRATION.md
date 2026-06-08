# Bun Runtime Distribution Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch AgentHub production packaging from native-heavy service single exe artifacts to an embedded Bun runtime plus service bundles and service-local native dependencies.

**Architecture:** CLI/Desktop start the packaged Bun runtime with `hub-server/index.js`. HubServer manages Agent Runtime by spawning the same packaged Bun runtime with `agent-runtime/index.js`. HubServer and Runtime bundles externalize native/dynamic dependencies, and package V1 keeps service-local `node_modules/` to preserve normal module resolution.

**Tech Stack:** Bun build/runtime, TypeScript, Hono, Prisma 7, SQLite/libsql adapter, existing Bun test suites.

---

## File Map

- Modify `hub-server/scripts/build.ts`: generate HubServer Bun bundle instead of `--compile`; keep web dist validation, Prisma generate, and migration manifest generation.
- Modify `hub-server/scripts/build.test.ts`: assert the new build command, external package list, and PTY helper copy.
- Modify `agent-runtime/package.json`: change `build` and `start` scripts to bundle/runtime commands.
- Modify `hub-server/src/config/index.ts`: add `--bun-bin` and `--runtime-entry` while keeping `--runtime-bin`.
- Modify `hub-server/src/config/index.test.ts`: cover bundle sidecar args and dev fallback.
- Modify `hub-server/src/bootstrap/database.ts`: treat `runtimeEntry` as production DB mode.
- Modify `hub-server/src/bootstrap/database.test.ts`: cover `runtimeEntry`.
- Modify `hub-server/src/services/sidecar-manager.ts`: support spawning Runtime bundle via Bun runtime and keep binary compatibility path.
- Modify `hub-server/src/services/sidecar-manager.test.ts`: cover bundle command, env token, retry, shutdown.
- Modify `hub-server/src/index.ts`: choose sidecar startup when `runtimeEntry` or `runtimeBin` exists.
- Modify `cli/src/distribution.ts`: resolve Bun runtime, service bundles, service-local `node_modules/`, and `public/`.
- Modify `cli/src/distribution.test.ts`: cover Windows/POSIX resource paths and missing-resource errors.
- Modify `cli/src/hub-runner.ts`: spawn `bun hub-server/index.js` with `--bun-bin` and `--runtime-entry`.
- Modify `cli/src/hub-runner.test.ts`: cover new HubServer command.
- Modify `scripts/package.ts`: assemble Bun runtime, service bundles, service-local `node_modules/`, CLI launcher, and `public/`.
- Modify `scripts/package.test.ts`: cover new layout and missing resource errors.
- Update docs touched by implementation if behavior changes from this roadmap.

## Task 1: Switch HubServer Build To Bun Bundle

**Files:**
- Modify `hub-server/scripts/build.test.ts`
- Modify `hub-server/scripts/build.ts`

- [ ] **Step 1: Write the failing build-command test**

Change `generates Prisma Client before compiling HubServer` to expect:

```ts
expect(createHubBuildCommands()).toEqual([
  ["bunx", "--bun", "prisma", "generate"],
  [
    "bun",
    "build",
    "src/index.ts",
    "--target",
    "bun",
    "--outdir",
    "dist",
    "--external",
    "sharp",
    "--external",
    "@libsql/client",
    "--external",
    "libsql",
    "--external",
    "node-pty",
  ],
])
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd hub-server && bun test scripts/build.test.ts`

Expected: FAIL if the command still contains `--compile` or uses single-file `--outfile` service output.

- [ ] **Step 3: Implement the minimal build command change**

Update `createHubBuildCommands()` in `hub-server/scripts/build.ts` to return the expected bundle command. Keep the existing migration manifest and Prisma generate order unchanged, then copy `src/services/terminal/pty-session-host.cjs` to `dist/pty-session-host.cjs`.

- [ ] **Step 4: Verify the focused test passes**

Run: `cd hub-server && bun test scripts/build.test.ts`

Expected: all tests in `scripts/build.test.ts` pass.

## Task 2: Switch Agent Runtime Build To Bun Bundle

**Files:**
- Modify `agent-runtime/package.json`

- [ ] **Step 1: Change scripts**

Update:

```json
{
  "build": "bun build src/index.ts --target bun --outdir dist",
  "start": "bun dist/index.js"
}
```

- [ ] **Step 2: Verify Runtime build**

Run: `cd agent-runtime && bun run build`

Expected: `agent-runtime/dist/index.js` exists.

- [ ] **Step 3: Verify Runtime tests**

Run: `cd agent-runtime && bun test`

Expected: Runtime tests pass.

## Task 3: Add HubServer Bundle Sidecar Config

**Files:**
- Modify `hub-server/src/config/index.test.ts`
- Modify `hub-server/src/config/index.ts`
- Modify `hub-server/src/bootstrap/database.test.ts`
- Modify `hub-server/src/bootstrap/database.ts`

- [ ] **Step 1: Add failing config test**

Add a test to `hub-server/src/config/index.test.ts`:

```ts
it("parses bundle sidecar flags", () => {
  const config = parseHubConfig([
    "--bun-bin",
    "C:\\AgentHub\\bun.exe",
    "--runtime-entry",
    "C:\\AgentHub\\agent-runtime\\index.js",
  ])

  expect(config.bunBin).toBe("C:\\AgentHub\\bun.exe")
  expect(config.runtimeEntry).toBe("C:\\AgentHub\\agent-runtime\\index.js")
})
```

- [ ] **Step 2: Run config test and verify it fails**

Run: `cd hub-server && bun test src/config/index.test.ts`

Expected: FAIL because `--bun-bin` / `--runtime-entry` are unknown.

- [ ] **Step 3: Implement config parsing**

Add `bun-bin` and `runtime-entry` to `parseArgs` options, add `bunBin?: string` and `runtimeEntry?: string` to the config schema, and expose them on the parsed config.

- [ ] **Step 4: Add production DB mode test**

Add a test to `hub-server/src/bootstrap/database.test.ts`:

```ts
it("treats runtime-entry sidecar startup as production database mode", () => {
  expect(isProductionDatabaseMode({
    ...devConfig,
    runtimeEntry: "C:/AgentHub/agent-runtime/index.js",
  })).toBe(true)
})
```

- [ ] **Step 5: Implement DB mode change**

Update `isProductionDatabaseMode()` so `Boolean(config.runtimeEntry)` also enables production DB mode.

- [ ] **Step 6: Verify focused tests**

Run:

```bash
cd hub-server && bun test src/config/index.test.ts src/bootstrap/database.test.ts
```

Expected: both test files pass.

## Task 4: Support Runtime Bundle In SidecarManager

**Files:**
- Modify `hub-server/src/services/sidecar-manager.test.ts`
- Modify `hub-server/src/services/sidecar-manager.ts`
- Modify `hub-server/src/index.ts`

- [ ] **Step 1: Add failing bundle spawn test**

Add a test asserting that `SidecarManager.start()` can receive `bunBin` and `runtimeEntry`, then spawns:

```ts
[
  "C:/AgentHub/bun.exe",
  "C:/AgentHub/agent-runtime/index.js",
  "--port",
  "4096",
  "--hostname",
  "127.0.0.1",
  "--hub-callback",
  "http://127.0.0.1:3456",
]
```

The test should also assert `AGENTHUB_RUNTIME_TOKEN` is present in child env.

- [ ] **Step 2: Run SidecarManager test and verify it fails**

Run: `cd hub-server && bun test src/services/sidecar-manager.test.ts`

Expected: FAIL because only `runtimeBin` is supported.

- [ ] **Step 3: Implement sidecar command selection**

Use this rule:

```ts
if (options.runtimeEntry) {
  command = [options.bunBin ?? "bun", options.runtimeEntry, ...runtimeArgs]
} else {
  command = [options.runtimeBin, ...runtimeArgs]
}
```

If `runtimeEntry` is set and `bunBin` is missing in production package mode, fail with a clear error before spawning.

- [ ] **Step 4: Update HubServer bootstrap selection**

In `hub-server/src/index.ts`, start SidecarManager when either `config.runtimeEntry` or `config.runtimeBin` exists. Development mode remains unchanged when neither exists.

- [ ] **Step 5: Verify focused sidecar tests**

Run: `cd hub-server && bun test src/services/sidecar-manager.test.ts`

Expected: SidecarManager tests pass.

## Task 5: Update CLI Resource Resolution And Hub Runner

**Files:**
- Modify `cli/src/distribution.test.ts`
- Modify `cli/src/distribution.ts`
- Modify `cli/src/hub-runner.test.ts`
- Modify `cli/src/hub-runner.ts`

- [ ] **Step 1: Add failing distribution path test**

Update expected Windows paths to include:

```ts
expect(paths.bunBin).toBe("C:\\AgentHub\\dist\\bun.exe")
expect(paths.hubServerEntry).toBe("C:\\AgentHub\\dist\\hub-server\\index.js")
expect(paths.hubServerNodeModulesDir).toBe("C:\\AgentHub\\dist\\hub-server\\node_modules")
expect(paths.runtimeEntry).toBe("C:\\AgentHub\\dist\\agent-runtime\\index.js")
expect(paths.runtimeNodeModulesDir).toBe("C:\\AgentHub\\dist\\agent-runtime\\node_modules")
```

- [ ] **Step 2: Run distribution tests and verify they fail**

Run: `cd cli && bun test src/distribution.test.ts`

Expected: FAIL because paths still point at `hub-server(.exe)` and `agent-runtime(.exe)`.

- [ ] **Step 3: Implement distribution path resolution**

Resolve Bun runtime and service bundle paths from `dirname(process.execPath)` or the launcher base directory. Keep Windows `.exe` suffix only for Bun runtime and compiled CLI launcher.

- [ ] **Step 4: Add failing hub-runner command test**

Update `cli/src/hub-runner.test.ts` to expect:

```ts
[
  "C:/AgentHub/dist/bun.exe",
  "C:/AgentHub/dist/hub-server/index.js",
  "--port",
  "3456",
  "--hostname",
  "127.0.0.1",
  "--bun-bin",
  "C:/AgentHub/dist/bun.exe",
  "--runtime-entry",
  "C:/AgentHub/dist/agent-runtime/index.js",
  "--public-dir",
  "C:/AgentHub/dist/public",
]
```

- [ ] **Step 5: Implement HubServer runner command**

Change `createHubServerCommand()` to spawn the Bun runtime with HubServer entry as the first argument, and pass `--bun-bin` / `--runtime-entry`.

- [ ] **Step 6: Verify CLI tests**

Run: `cd cli && bun test`

Expected: CLI tests pass.

## Task 6: Update Package Assembly

**Files:**
- Modify `scripts/package.test.ts`
- Modify `scripts/package.ts`

- [ ] **Step 1: Add failing path resolution test**

Update package path expectations:

```ts
sources: {
  bunBin: "<current Bun executable>",
  cliBin: ".../cli/dist/agenthub-cli(.exe)",
  hubServerEntry: ".../hub-server/dist/index.js",
  hubServerPtySessionHost: ".../hub-server/dist/pty-session-host.cjs",
  hubServerNodeModulesDir: ".../hub-server/node_modules",
  runtimeEntry: ".../agent-runtime/dist/index.js",
  runtimeNodeModulesDir: ".../agent-runtime/node_modules",
  webDistDir: ".../web/dist",
}
outputs: {
  bunBin: ".../dist/bun(.exe)",
  cliBin: ".../dist/agenthub-cli(.exe)",
  hubServerEntry: ".../dist/hub-server/index.js",
  hubServerPtySessionHost: ".../dist/hub-server/pty-session-host.cjs",
  hubServerNodeModulesDir: ".../dist/hub-server/node_modules",
  runtimeEntry: ".../dist/agent-runtime/index.js",
  runtimeNodeModulesDir: ".../dist/agent-runtime/node_modules",
  publicDir: ".../dist/public",
}
```

- [ ] **Step 2: Run package tests and verify they fail**

Run: `bun test scripts/package.test.ts`

Expected: FAIL because package still expects service executables.

- [ ] **Step 3: Implement package inputs and copy operations**

Update `assertPackageInputs()` to require Bun runtime, CLI launcher, service bundles, service-local `node_modules/`, and Web dist.

Update `packageAgentHub()` to copy:

```text
bun(.exe)
agenthub-cli(.exe)
hub-server/dist/index.js -> dist/hub-server/index.js
hub-server/dist/pty-session-host.cjs -> dist/hub-server/pty-session-host.cjs
hub-server/node_modules -> dist/hub-server/node_modules
agent-runtime/dist/index.js -> dist/agent-runtime/index.js
agent-runtime/node_modules -> dist/agent-runtime/node_modules
web/dist -> dist/public
```

On POSIX, chmod Bun runtime and CLI launcher to `0755`.

- [ ] **Step 4: Verify package tests**

Run: `bun test scripts/package.test.ts`

Expected: package tests pass.

## Task 7: End-To-End Verification

**Files:**
- No new files unless tests expose a behavior gap.

- [ ] **Step 1: Run focused tests**

Run:

```bash
cd hub-server && bun test scripts/build.test.ts src/config/index.test.ts src/bootstrap/database.test.ts src/services/sidecar-manager.test.ts
cd cli && bun test
bun test scripts/package.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run type checks**

Run:

```bash
cd hub-server && bunx tsc --noEmit
cd cli && bunx tsc --noEmit
```

Expected: both commands exit 0.

- [ ] **Step 3: Run build and package**

Run:

```bash
bun run build
bun run package
```

Expected: `dist/` contains Bun runtime, CLI launcher, HubServer bundle, Runtime bundle, service-local `node_modules/`, and `public/`.

- [ ] **Step 4: Run production smoke**

Run:

```bash
cd dist
./agenthub-cli --no-browser
```

Expected:

- `GET /health` returns HubServer `status: "ok"`.
- `/` returns Web `index.html`.
- HubServer starts Agent Runtime sidecar through `bun agent-runtime/index.js`.
- `GET /api/system/services/status` reports `agent-runtime` reachable.
- Terminating CLI exits HubServer and Agent Runtime.

## Open Constraints

- V1 copies service-local `node_modules/` for reliability. A later optimization pass can prune to external dependency closure after smoke is stable.
- `--runtime-bin` remains supported for compatibility but CLI/Desktop should use `--bun-bin` + `--runtime-entry`.
- Development mode remains manual: absence of `runtimeEntry` and `runtimeBin` means HubServer uses `runtimeUrl` and does not spawn Runtime.
