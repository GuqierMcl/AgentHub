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

let monacoConfigured = false

function configureMonacoDiagnostics() {
  if (monacoConfigured) return
  monacoConfigured = true

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const languages = monaco.languages as any
  const tsApi = languages.typescript
  const jsonApi = languages.json
  const htmlApi = languages.html
  const cssApi = languages.css

  if (!tsApi || !jsonApi || !htmlApi || !cssApi) {
    return
  }

  tsApi.typescriptDefaults.setEagerModelSync(true)
  tsApi.javascriptDefaults.setEagerModelSync(true)

  tsApi.typescriptDefaults.setCompilerOptions({
    allowNonTsExtensions: true,
    module: tsApi.ModuleKind.ESNext,
    moduleResolution: tsApi.ModuleResolutionKind.NodeJs,
    target: tsApi.ScriptTarget.Latest,
    jsx: tsApi.JsxEmit.ReactJSX,
  })

  tsApi.javascriptDefaults.setCompilerOptions({
    allowJs: true,
    allowNonTsExtensions: true,
    checkJs: true,
    module: tsApi.ModuleKind.ESNext,
    moduleResolution: tsApi.ModuleResolutionKind.NodeJs,
    target: tsApi.ScriptTarget.Latest,
    jsx: tsApi.JsxEmit.ReactJSX,
  })

  tsApi.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
    onlyVisible: false,
  })

  tsApi.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
    onlyVisible: false,
  })

  jsonApi.jsonDefaults.setDiagnosticsOptions({
    ...jsonApi.jsonDefaults.diagnosticsOptions,
    validate: true,
    allowComments: true,
    schemaRequest: "warning",
    schemaValidation: "warning",
    trailingCommas: "warning",
  })

  htmlApi.htmlDefaults.setOptions({
    ...htmlApi.htmlDefaults.options,
  })
  htmlApi.htmlDefaults.setModeConfiguration({
    ...htmlApi.htmlDefaults.modeConfiguration,
    diagnostics: true,
  })

  cssApi.cssDefaults.setOptions({
    ...cssApi.cssDefaults.options,
    validate: true,
  })
  cssApi.scssDefaults.setOptions({
    ...cssApi.scssDefaults.options,
    validate: true,
  })
  cssApi.lessDefaults.setOptions({
    ...cssApi.lessDefaults.options,
    validate: true,
  })
  cssApi.cssDefaults.setModeConfiguration({
    ...cssApi.cssDefaults.modeConfiguration,
    diagnostics: true,
  })
  cssApi.scssDefaults.setModeConfiguration({
    ...cssApi.scssDefaults.modeConfiguration,
    diagnostics: true,
  })
  cssApi.lessDefaults.setModeConfiguration({
    ...cssApi.lessDefaults.modeConfiguration,
    diagnostics: true,
  })
}

configureMonacoDiagnostics()

// Must run at module level, before any Editor component renders,
// otherwise @monaco-editor/react will load Monaco from CDN.
loader.config({ monaco })
