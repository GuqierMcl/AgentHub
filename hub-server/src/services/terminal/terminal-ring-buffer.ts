export class TerminalRingBuffer {
  private buffer: string[] = []
  private totalBytes = 0
  private readonly maxBytes: number

  constructor(maxBytes: number) {
    this.maxBytes = maxBytes
  }

  write(data: string): void {
    const bytes = new TextEncoder().encode(data).length
    this.buffer.push(data)
    this.totalBytes += bytes

    while (this.totalBytes > this.maxBytes && this.buffer.length > 0) {
      const removed = this.buffer.shift()!
      this.totalBytes -= new TextEncoder().encode(removed).length
    }
  }

  flush(): string[] {
    const result = [...this.buffer]
    this.buffer = []
    this.totalBytes = 0
    return result
  }

  snapshot(): string[] {
    return [...this.buffer]
  }

  clear(): void {
    this.buffer = []
    this.totalBytes = 0
  }

  get size(): number {
    return this.totalBytes
  }
}
