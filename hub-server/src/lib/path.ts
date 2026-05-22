import path from 'node:path'
import os from 'node:os'

export function getAppDataDir(): string {
  const envDir = process.env.AGENTHUB_DATA_DIR
  if (envDir) {
    return envDir
  }

  const platform = os.platform()
  if (platform === 'win32') {
    return path.join(os.homedir(), 'AppData', 'Roaming', 'AgentHub')
  }
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'AgentHub')
  }
  return path.join(os.homedir(), '.local', 'share', 'AgentHub')
}