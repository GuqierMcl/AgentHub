# ADR-002: hub-server 迁移到 Prisma 7 + Bun SQLite 适配器

## 状态

已采纳

## 上下文

`hub-server/` 使用 SQLite 作为持久化数据库，并通过 Bun 运行时启动。Prisma ORM 7 引入了新的 `prisma-client` 生成器和 `prisma.config.ts` 配置入口，同时要求在 SQLite + Bun 场景下使用 driver adapter。

现有实现仍基于 Prisma 5 的约定：

- `prisma-client-js` 生成器
- `datasource.db.url = env("DATABASE_URL")`
- `@prisma/client` 直接导入
- `bunx prisma ...` 命令

这与 Prisma 7 的新约定不再一致，需要统一升级。

## 决策

hub-server 的 Prisma 7 方案如下：

1. `prisma/schema.prisma` 只保留模型与 generator，generator 使用 `prisma-client` 并输出到 `src/generated/prisma`。
2. `prisma.config.ts` 负责 schema 路径、migrations 路径、datasource URL 和 CLI 场景下的本地 SQLite 文件初始化；默认 datasource 仍用于 CLI scratch 数据库，面向 Hub Server 开发启动的迁移由 `dev:migrate` 注入 `DATABASE_URL`。
3. `src/lib/db.ts` 通过 `@prisma/adapter-libsql` 初始化 Prisma Client，并动态加载生成产物。
4. Prisma CLI 命令统一通过 `hub-server/package.json` scripts 执行；开发环境 `bun dev` 先运行 `dev:migrate`，再启动服务。
5. 生成产物不纳入版本控制，运行时和 `typecheck` 流程会按需生成。
6. Prisma CLI 迁移脚本在执行迁移前先确保 `file:` URL 指向的 SQLite 文件存在。
7. 应用运行时代码不直接执行 `prisma migrate deploy`。当前阶段暂不实现生产环境 migration runner，生产迁移策略后续单独设计。

## 影响

### 正面影响

- 与 Prisma 7 的官方约定对齐。
- 保持 hub-server 在 Bun + SQLite 下的本地优先运行模型。
- Prisma 相关逻辑仍集中在 `src/lib/db.ts`，仓储层不需要感知底层变更。

### 代价与风险

- 需要维护 Prisma 生成产物的生成流程。
- `prisma.config.ts` 需要在无显式环境变量时提供开发默认值。
- Prisma 7 的 SQLite schema engine 在数据库文件缺失时会以不透明错误失败，因此启动流程必须保留文件 touch 步骤。
- `initDatabase()` 不再自动迁移空数据库；开发和测试入口必须在初始化 Prisma Client 前显式准备数据库 schema。
