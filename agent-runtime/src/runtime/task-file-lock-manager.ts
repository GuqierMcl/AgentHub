export type TaskFileLockOwner = {
  runId: string
  taskId: string
  targetAgentId: string
  sourceAgentId: string
  groupId?: string
}

export type TaskFileLockConflict = {
  path: string
  owner: TaskFileLockOwner
}

export type TaskFileLockAcquireResult =
  | { acquired: true }
  | {
      acquired: false
      conflicts: TaskFileLockConflict[]
    }

type LockRecord = {
  workspaceId: string
  path: string
  owner: TaskFileLockOwner
}

export class TaskFileLockManager {
  private locks = new Map<string, LockRecord>()

  tryAcquire(options: {
    workspaceId: string
    paths: string[]
    owner: TaskFileLockOwner
  }): TaskFileLockAcquireResult {
    const paths = Array.from(new Set(options.paths))
    const conflicts: TaskFileLockConflict[] = []

    for (const path of paths) {
      const existing = this.locks.get(this.key(options.workspaceId, path))
      if (!existing) {
        continue
      }

      if (
        existing.owner.runId === options.owner.runId &&
        existing.owner.taskId === options.owner.taskId
      ) {
        continue
      }

      conflicts.push({
        path,
        owner: existing.owner,
      })
    }

    if (conflicts.length > 0) {
      return { acquired: false, conflicts }
    }

    for (const path of paths) {
      this.locks.set(this.key(options.workspaceId, path), {
        workspaceId: options.workspaceId,
        path,
        owner: options.owner,
      })
    }

    return { acquired: true }
  }

  releaseByTask(runId: string, taskId: string): void {
    for (const [key, lock] of this.locks) {
      if (lock.owner.runId === runId && lock.owner.taskId === taskId) {
        this.locks.delete(key)
      }
    }
  }

  releaseByRun(runId: string): void {
    for (const [key, lock] of this.locks) {
      if (lock.owner.runId === runId) {
        this.locks.delete(key)
      }
    }
  }

  private key(workspaceId: string, path: string): string {
    return `${workspaceId}\0${path}`
  }
}
