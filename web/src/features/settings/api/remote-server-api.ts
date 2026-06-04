export type RemoteServer = {
  id: string
  hostname: string
  host: string
  username: string
  port: number
  identityFilePath: string | null
  createdAt: string
  updatedAt: string
}

export type CreateRemoteServerInput = {
  hostname: string
  host: string
  username: string
  port?: number
  identityFilePath?: string
}

export type UpdateRemoteServerInput = Partial<CreateRemoteServerInput>

export type ImportResult = {
  imported: number
  updated: number
  errors: string[]
}

export type TestConnectionResult = {
  success: boolean
  message: string
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error?.message ?? `Request failed: ${res.status}`)
  }
  return res.json()
}

export const remoteServerApi = {
  list: () => request<{ servers: RemoteServer[] }>('/api/remote-servers'),

  create: (input: CreateRemoteServerInput) =>
    request<RemoteServer>('/api/remote-servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  update: (id: string, input: UpdateRemoteServerInput) =>
    request<RemoteServer>(`/api/remote-servers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  delete: (id: string) =>
    request<{ success: boolean }>(`/api/remote-servers/${id}`, {
      method: 'DELETE',
    }),

  importSshConfig: (configPath?: string) =>
    request<ImportResult>('/api/remote-servers/import-ssh-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(configPath ? { configPath } : {}),
    }),

  testConnection: (id: string) =>
    request<TestConnectionResult>(`/api/remote-servers/${id}/test`, {
      method: 'POST',
    }),
}
