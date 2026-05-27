# AgentHub Desktop

Electrobun desktop shell for AgentHub. The desktop app does not host its own frontend; it opens the existing AgentHub web app by URL.

## Getting Started

```bash
# Install dependencies
bun install

# Start the desktop shell
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
