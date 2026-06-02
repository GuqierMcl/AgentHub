import { describe, expect, it } from "bun:test"
import { parseUnifiedDiff } from "./unified-diff"

describe("parseUnifiedDiff", () => {
  it("parses modified file hunks with line numbers", () => {
    const files = parseUnifiedDiff([
      "diff --git a/src/index.ts b/src/index.ts",
      "index 1111111..2222222 100644",
      "--- a/src/index.ts",
      "+++ b/src/index.ts",
      "@@ -1,2 +1,3 @@",
      " const a = 1",
      "-const b = 2",
      "+const b = 3",
      "+const c = 4",
      "",
    ].join("\n"))

    expect(files).toHaveLength(1)
    expect(files[0]?.path).toBe("src/index.ts")
    expect(files[0]?.hunks[0]?.lines).toMatchObject([
      { type: "context", oldLine: 1, newLine: 1 },
      { type: "deletion", oldLine: 2 },
      { type: "addition", newLine: 2 },
      { type: "addition", newLine: 3 },
    ])
  })

  it("parses added files", () => {
    const files = parseUnifiedDiff([
      "diff --git a/new.txt b/new.txt",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/new.txt",
      "@@ -0,0 +1,2 @@",
      "+hello",
      "+world",
    ].join("\n"))

    expect(files[0]?.path).toBe("new.txt")
    expect(files[0]?.status).toBe("added")
    expect(files[0]?.hunks[0]?.lines).toHaveLength(2)
  })

  it("parses renamed files", () => {
    const files = parseUnifiedDiff([
      "diff --git a/old.ts b/new.ts",
      "similarity index 90%",
      "rename from old.ts",
      "rename to new.ts",
    ].join("\n"))

    expect(files[0]).toMatchObject({
      oldPath: "old.ts",
      path: "new.ts",
      status: "renamed",
    })
  })

  it("marks binary diffs", () => {
    const files = parseUnifiedDiff([
      "diff --git a/image.png b/image.png",
      "Binary files a/image.png and b/image.png differ",
    ].join("\n"))

    expect(files[0]?.binary).toBe(true)
    expect(files[0]?.hunks).toHaveLength(0)
  })

  it("returns no files for empty patches", () => {
    expect(parseUnifiedDiff("")).toEqual([])
  })
})
