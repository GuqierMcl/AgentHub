# GitHub Release Workflow

本文档记录 AgentHub 首版 GitHub Release 流水线。生产分发总览见 `docs/architecture/PRODUCTION_DISTRIBUTION.md`。

## 触发方式

`.github/workflows/release.yml` 在推送 `v*` tag 时触发：

```bash
git tag v1.0.2
git push origin v1.0.2
```

流水线会读取根目录 `package.json#version`，并要求 tag 精确等于 `v${version}`。例如根版本为 `1.0.2` 时，只允许 `v1.0.2` 发布。

## Release 产物

V1 只发布 GitHub Release，不发布 npm。

CLI 产物：

- `agenthub-cli-v<version>-windows-x64.zip`
- `agenthub-cli-v<version>-linux-x64.zip`
- `agenthub-cli-v<version>-macos-arm64.zip`
- `agenthub-cli-v<version>-macos-x64.zip`

Desktop 产物：

- `agenthub-desktop-v<version>-windows-x64.zip`

每个产物都会附带同名 `.sha256` 文件。

## Job 结构

- `validate`：校验 release tag 与根版本一致，并运行版本测试。
- `build-cli`：按平台构建 `bun run build && bun run package`，压缩根级 `dist/`。非 Windows job 会先准备 `node-gyp`，Linux job 会额外安装 Python/make/g++，用于 `node-pty` 缺少 prebuild 时的 native rebuild。
- `build-desktop-windows`：运行 `bun run build:desktop`，收集 Electrobun 生成的 Windows installer zip。
- `publish`：下载所有 job artifact，并使用 GitHub CLI 创建 Release。

Release job 使用仓库 token 和 `contents: write` 权限执行：

```bash
gh release create "$GITHUB_REF_NAME" release-artifacts/* --verify-tag --generate-notes
```

## Desktop 图标与启动约束

Desktop release 构建会把根级 `dist/` 复制到 `Resources/app/agenthub-runtime/`，并额外复制 `desktop/assets/icon.png` 到 `Resources/app/assets/icon.png`，供启动加载窗口显示产品图标。

Windows release 构建还会通过 `desktop/scripts/patch-windows-icons.ts` 执行补丁：

- `postWrap` 阶段 patch AgentHub launcher 图标。
- `postPackage` 阶段 patch Windows installer 图标。
- 若 Electrobun 已经生成 installer zip，则重新生成 zip，确保 GitHub Release 上传的是 patch 后的 installer。

内置 Bun runtime 保持上游文件资源不变，不做图标改写。

## 非目标

- 不发布 npm registry。
- 不构建 macOS/Linux Desktop 安装包。
- 不做代码签名、公证、自动更新发布源配置。
- 不在本地自动安装 Desktop 包做 smoke；安装测试由开发者手动执行。

## 发布前检查

发布前建议本地完成：

```bash
bun test scripts/version.test.ts
bun test desktop/src/bun/agenthub-service.test.ts desktop/src/bun/loading-window.test.ts
cd desktop && bun test scripts/patch-windows-icons.test.ts
```

如需验证安装器，由开发者手动运行：

```bash
bun run build:desktop
```

然后安装 `desktop/artifacts/*AgentHub-Setup.zip` 中的安装器并启动应用。
