# Tasks: 远程服务器管理

## 1. 数据库模型 & 基础设施

- [x] 1.1 在 `hub-server/prisma/schema.prisma` 新增 `RemoteServer` 模型
- [x] 1.2 在 `hub-server/src/lib/id.ts` 新增 `rms` ID 前缀
- [x] 1.3 运行 Prisma 迁移生成数据库表

## 2. 后端 API 实现

- [x] 2.1 创建 `hub-server/src/domains/remote-server/types.ts`（Zod 校验 + TypeScript 类型）
- [x] 2.2 创建 `hub-server/src/repositories/remote-server.repo.ts`（CRUD 数据操作）
- [x] 2.3 创建 `hub-server/src/services/remote-server.service.ts`（业务逻辑）
- [x] 2.4 创建 `hub-server/src/routers/remote-server.ts`（API 路由）
- [x] 2.5 实现 SSH config 文件解析逻辑
- [x] 2.6 在 `hub-server/src/routers/index.ts` 注册新路由

## 3. 前端实现

- [x] 3.1 更新 `web/src/features/settings/types.ts` 新增 `"remote-server"` tab id
- [x] 3.2 更新 `SettingsSidebar.tsx` 新增「远程服务器」菜单项（连接管理分组）
- [x] 3.3 更新 `SettingsContent.tsx` 新增 tab 路由
- [x] 3.4 创建 `web/src/features/settings/api/remote-server-api.ts`（API 客户端）
- [x] 3.5 创建 `RemoteServerContent.tsx`（主内容组件：服务器卡片列表 + 操作栏）
- [x] 3.6 创建 `RemoteServerCard.tsx`（服务器信息卡片组件）
- [x] 3.7 创建 `RemoteServerDialog.tsx`（新建/编辑对话框）
- [x] 3.8 实现 SSH 配置导入功能（前端触发导入）

## 4. 验证

- [x] 4.1 TypeScript 类型检查通过（web + hub-server）
- [x] 4.2 前后端联调：CRUD 操作完整性测试
- [x] 4.3 SSH 配置导入功能验证
