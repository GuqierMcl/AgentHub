import { Hono, Context } from 'hono'
import { execSync } from 'node:child_process'
import { platform, tmpdir } from 'node:os'
import { existsSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../lib/logger'

const workspace = new Hono()

workspace.post('/api/workspace/select', async (c: Context) => {
  try {
    const os = platform()
    let selectedPath = ''

    if (os === 'win32') {
      const psScript = [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$f = New-Object System.Windows.Forms.FolderBrowserDialog',
        '$f.Description = ""',
        '$f.ShowNewFolderButton = $false',
        '$result = $f.ShowDialog()',
        "if ($result -eq 'OK') { Write-Output $f.SelectedPath }",
      ].join('; ')
      const tmpFile = join(tmpdir(), `workspace-select-${Date.now()}.ps1`)
      const BOM = '\uFEFF'
      writeFileSync(tmpFile, BOM + psScript, 'utf-8')
      try {
        const result = execSync(
          `powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`,
          { encoding: 'utf-8', timeout: 60000, stdio: ['pipe', 'pipe', 'ignore'] }
        ).trim()
        if (result) selectedPath = result
      } finally {
        try { unlinkSync(tmpFile) } catch { /* ignore */ }
      }
    } else if (os === 'darwin') {
      const result = execSync(
        `osascript -e 'tell app "System Events" to POSIX path of (choose folder with prompt "选择工作空间目录")'`,
        { encoding: 'utf-8', timeout: 60000, stdio: ['pipe', 'pipe', 'ignore'] }
      ).trim()
      if (result) selectedPath = result
    } else {
      const result = execSync(
        `zenity --file-selection --directory --title="选择工作空间目录"`,
        { encoding: 'utf-8', timeout: 60000, stdio: ['pipe', 'pipe', 'ignore'] }
      ).trim()
      if (result) selectedPath = result
    }

    if (!selectedPath) {
      return c.json({ path: null })
    }

    if (!existsSync(selectedPath)) {
      logger.warn({ selectedPath }, 'Selected workspace path does not exist')
    }

    return c.json({ path: selectedPath })
  } catch (err) {
    logger.debug({ err }, 'Workspace select cancelled or failed')
    return c.json({ path: null })
  }
})

export default workspace
