# AgentHub Desktop

Electrobun desktop shell for AgentHub. Development opens a manually started web URL; production starts the packaged HubServer and opens the Web app only after HubServer is ready.

## Getting Started

```bash
# Install dependencies
bun install

# Start the desktop shell in development mode
bun run dev
```

By default the desktop shell opens:

```text
http://127.0.0.1:5173
```

Override it with:

```powershell
$env:AGENTHUB_DESKTOP_URL = "http://127.0.0.1:5173"
bun run dev
```

## Production Build

Run from the repository root:

```bash
bun run build:desktop
```

This command builds Web, Agent Runtime, HubServer, CLI, assembles the root `dist/` resource directory, then runs the Electrobun release build. The release build copies `../dist` into the desktop app resources as `app/agenthub-runtime/` and copies `assets/icon.png` as `app/assets/icon.png` for the startup loading window.

In production mode the Desktop app:

1. Shows a lightweight loading window.
2. Starts the packaged Bun runtime with `hub-server/index.js`.
3. Waits for HubServer `/health`.
4. Opens the main window at `http://127.0.0.1:<hub-port>`.
5. Shuts down HubServer when the desktop process exits.

For local smoke tests, point Desktop at an assembled resource directory:

```powershell
$env:AGENTHUB_DESKTOP_RESOURCES_DIR = "D:\PyWorkSpace\AgentHub\dist"
```

The app version is read from the root `package.json` version.

On Windows, release builds run `scripts/patch-windows-icons.ts` from Electrobun `postWrap` and `postPackage` hooks. The hook patches the AgentHub launcher and installer icon with `assets/icon.ico`; the bundled Bun runtime is copied unchanged.

## Project Structure

```
├── src/
│   ├── bun/
│   │   └── index.ts        # Main process (Electrobun/Bun)
├── electrobun.config.ts    # Electrobun configuration
└── package.json
```

## Customizing

- **Window settings**: Edit `src/bun/index.ts`
- **App metadata**: Edit `electrobun.config.ts`
