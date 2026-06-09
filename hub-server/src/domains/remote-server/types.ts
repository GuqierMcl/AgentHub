import { z } from 'zod'

export const CreateRemoteServerSchema = z.object({
  hostname: z.string().min(1).max(255),
  host: z.string().min(1).max(255),
  username: z.string().min(1).max(128),
  port: z.number().int().min(1).max(65535).optional().default(22),
  identityFilePath: z.string().max(1024).optional(),
})

export const UpdateRemoteServerSchema = z.object({
  hostname: z.string().min(1).max(255).optional(),
  host: z.string().min(1).max(255).optional(),
  username: z.string().min(1).max(128).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  identityFilePath: z.string().max(1024).nullable().optional(),
})

export const ImportSshConfigSchema = z.object({
  configPath: z.string().max(1024).optional(),
})

export type CreateRemoteServerInput = z.infer<typeof CreateRemoteServerSchema>
export type UpdateRemoteServerInput = z.infer<typeof UpdateRemoteServerSchema>
export type ImportSshConfigInput = z.infer<typeof ImportSshConfigSchema>

export interface RemoteServerDTO {
  id: string
  hostname: string
  host: string
  username: string
  port: number
  identityFilePath: string | null
  createdAt: string
  updatedAt: string
}

export interface DeploymentServerSummaryDTO {
  id: string
  displayName: string
  hostLabel: string
  port: number
  user: string
  updatedAt: string
}

export interface DeploymentServerMaterialDTO extends DeploymentServerSummaryDTO {
  host: string
  username: string
  privateKey?: string
  agent?: string
}

export interface ImportResult {
  imported: number
  updated: number
  errors: string[]
}

export interface TestConnectionResult {
  success: boolean
  message: string
}
