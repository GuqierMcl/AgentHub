import { join } from "node:path"
import { existsSync, mkdirSync } from "node:fs"
import { readFile, writeFile, stat } from "node:fs/promises"
import { ModelsDevCatalogSchema, type ModelsDevCatalog } from "./types"

const MODELS_DEV_API_URL = "https://models.dev/api.json"
const CATALOG_TTL_MS = 3600 * 1000 // 1 小时
const FETCH_TIMEOUT_MS = 10_000 // 10 秒

export class CatalogManager {
  private dataDir: string
  private catalogPath: string
  private memoryCache: ModelsDevCatalog | null = null
  private lastFetchTime: number = 0

  constructor(dataDir: string) {
    this.dataDir = dataDir
    this.catalogPath = join(dataDir, "catalog.json")
  }

  /**
   * 获取目录数据
   * 回退链：内存缓存 → 本地文件 → 在线拉取 → 空
   */
  async get(forceRefresh: boolean = false): Promise<ModelsDevCatalog> {
    // 1. 检查内存缓存
    if (!forceRefresh && this.memoryCache && this.isCacheValid()) {
      return this.memoryCache
    }

    // 2. 尝试从本地文件加载
    if (!forceRefresh) {
      const fileCatalog = await this.loadFromFile()
      if (fileCatalog) {
        this.memoryCache = fileCatalog
        this.lastFetchTime = Date.now()
        return fileCatalog
      }
    }

    // 3. 尝试在线拉取
    const onlineCatalog = await this.fetchFromOnline()
    if (onlineCatalog) {
      await this.saveToFile(onlineCatalog)
      this.memoryCache = onlineCatalog
      this.lastFetchTime = Date.now()
      return onlineCatalog
    }

    // 4. 返回空目录
    return {}
  }

  /**
   * 强制刷新目录
   */
  async refresh(): Promise<ModelsDevCatalog> {
    return this.get(true)
  }

  /**
   * 检查内存缓存是否有效
   */
  private isCacheValid(): boolean {
    return Date.now() - this.lastFetchTime < CATALOG_TTL_MS
  }

  /**
   * 从本地文件加载目录
   */
  private async loadFromFile(): Promise<ModelsDevCatalog | null> {
    try {
      if (!existsSync(this.catalogPath)) {
        return null
      }

      // 检查文件修改时间
      const fileStat = await stat(this.catalogPath)
      const fileAge = Date.now() - fileStat.mtimeMs
      if (fileAge > CATALOG_TTL_MS) {
        return null // 文件已过期
      }

      const content = await readFile(this.catalogPath, "utf-8")
      const data = JSON.parse(content)
      return ModelsDevCatalogSchema.parse(data)
    } catch (error) {
      console.warn("Failed to load catalog from file:", error)
      return null
    }
  }

  /**
   * 保存目录到本地文件
   */
  private async saveToFile(catalog: ModelsDevCatalog): Promise<void> {
    try {
      // 确保目录存在
      if (!existsSync(this.dataDir)) {
        mkdirSync(this.dataDir, { recursive: true })
      }
      const content = JSON.stringify(catalog, null, 2)
      await writeFile(this.catalogPath, content, "utf-8")
    } catch (error) {
      console.warn("Failed to save catalog to file:", error)
    }
  }

  /**
   * 从 models.dev 在线拉取目录
   */
  private async fetchFromOnline(): Promise<ModelsDevCatalog | null> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

      const response = await fetch(MODELS_DEV_API_URL, {
        signal: controller.signal,
        headers: {
          "Accept": "application/json",
        },
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        console.warn(`Failed to fetch models.dev: ${response.status} ${response.statusText}`)
        return null
      }

      const data = await response.json()
      return ModelsDevCatalogSchema.parse(data)
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        console.warn("Fetch models.dev timeout")
      } else {
        console.warn("Failed to fetch models.dev:", error)
      }
      return null
    }
  }
}