import { beforeEach, describe, expect, it } from "bun:test"

import { useTabStore } from "./tab-store"

describe("tab store", () => {
  beforeEach(() => {
    useTabStore.setState({
      tabs: [],
      activeTabUid: null,
      mountedTabUids: new Set(),
      tabCounters: { terminal: 0, preview: 0 },
      isWorkspaceCollapsed: true,
      workspaceFocusRequest: null,
      workspaceFocusRequestSeq: 0,
    })
  })

  it("updates an existing preview tab title after the page title is known", () => {
    const uid = useTabStore
      .getState()
      .openTab("preview", "www.baidu.com", {
        source: "manual",
        initialUrl: "https://www.baidu.com/s?wd=test",
      })

    useTabStore.getState().updateTabTitle(uid, "百度一下，你就知道")

    expect(useTabStore.getState().tabs).toEqual([
      expect.objectContaining({
        uid,
        type: "preview",
        title: "百度一下，你就知道",
      }),
    ])
  })
})
