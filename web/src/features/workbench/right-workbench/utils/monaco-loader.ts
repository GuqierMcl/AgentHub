import * as monaco from "monaco-editor"
import { loader } from "@monaco-editor/react"

// Vite transforms static new URL() patterns into separate worker chunks.
// MonacoEnvironment.getWorker tells Monaco how to load them at runtime.
globalThis.MonacoEnvironment = {
  getWorker(_: string, label: string) {
    switch (label) {
      case "json":
        return new Worker(new URL("monaco-editor/esm/vs/language/json/json.worker.js", import.meta.url), { type: "module" })
      case "css":
      case "scss":
      case "less":
        return new Worker(new URL("monaco-editor/esm/vs/language/css/css.worker.js", import.meta.url), { type: "module" })
      case "html":
      case "handlebars":
      case "razor":
        return new Worker(new URL("monaco-editor/esm/vs/language/html/html.worker.js", import.meta.url), { type: "module" })
      case "typescript":
      case "javascript":
        return new Worker(new URL("monaco-editor/esm/vs/language/typescript/ts.worker.js", import.meta.url), { type: "module" })
      default:
        return new Worker(new URL("monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url), { type: "module" })
    }
  },
}

// Must run at module level, before any Editor component renders,
// otherwise @monaco-editor/react will load Monaco from CDN.
loader.config({ monaco })
