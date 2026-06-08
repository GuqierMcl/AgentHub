import { createServer } from "node:net"

export async function findAvailablePort(hostname = "127.0.0.1"): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, hostname, () => {
      const address = server.address()
      server.close(() => {
        if (typeof address === "object" && address) {
          resolve(address.port)
          return
        }
        reject(new Error("Failed to allocate an available port"))
      })
    })
  })
}
