import { Hono, Context } from 'hono'
import { spawnSync, execSync } from 'node:child_process'
import { platform, tmpdir } from 'node:os'
import { existsSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../lib/logger'

const workspace = new Hono()

workspace.post('/api/workspace/select', async (c: Context) => {
  try {
    const os = platform()
    let selectedPath = ''

    if (os === 'win32') {
      const outFile = join(tmpdir(), `workspace-select-out-${Date.now()}.txt`)
      const psScript = [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$f = New-Object System.Windows.Forms.FolderBrowserDialog',
        '$f.Description = ""',
        '$f.ShowNewFolderButton = $false',
        '$result = $f.ShowDialog()',
        `if ($result -eq 'OK') { $f.SelectedPath | Out-File -FilePath '${outFile.replace(/\\/g, '\\\\')}' -Encoding UTF8 }`,
      ].join('; ')
      const tmpFile = join(tmpdir(), `workspace-select-${Date.now()}.ps1`)
      writeFileSync(tmpFile, '\uFEFF' + psScript, 'utf-8')
      try {
        spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpFile], {
          stdio: 'ignore',
          timeout: 300000,
        })
        try {
          const output = readFileSync(outFile, 'utf-8').trim()
          if (output) selectedPath = output
        } catch { /* ignore */ }
      } finally {
        try { unlinkSync(tmpFile) } catch { /* ignore */ }
        try { unlinkSync(outFile) } catch { /* ignore */ }
      }
    } else if (os === 'darwin') {
      const result = execSync(
        `osascript -e 'tell app "System Events" to POSIX path of (choose folder with prompt "选择工作空间目录")'`,
        { encoding: 'utf-8', timeout: 120000, stdio: ['pipe', 'pipe', 'ignore'] }
      ).trim()
      if (result) selectedPath = result
    } else {
      const result = execSync(
        `zenity --file-selection --directory --title="选择工作空间目录"`,
        { encoding: 'utf-8', timeout: 120000, stdio: ['pipe', 'pipe', 'ignore'] }
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
