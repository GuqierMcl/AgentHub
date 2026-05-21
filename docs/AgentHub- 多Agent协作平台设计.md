# AgentHub- 多Agent协作平台设计

# 课题：AgentHub - 多 Agent 协作平台

# 课题背景

通过对话式交互创建⽹⻚、Workflow等产物。本课题要求学⽣构建⼀个该业务的简化实战版：多Agent 协作平台（AgentHub）。

平台采⽤IM聊天作为核⼼交互范式。⽤⼾像使⽤⻜书/微信⼀样，通过新建对话、发送消息的⽅式与不同AIAgent进⾏交互。每个Agent就是⼀个"聊天对象"，⽤⼾可以：

• 新建对话：创建⼀个新的聊天会话，选择或指定要对话的 Agent（如 Claude Code、Codex、OpenCode 等）  
• 多会话并⾏：同时开启多个对话窗⼝，分别与不同Agent交流不同任务（类似IM的多个聊天窗⼝）  
• 群聊协作：在⼀个对话中 @ 多个 Agent，由主 Agent（Orchestrator）⾃动协调分⼯，多个 Agent像群聊成员⼀样依次回复各⾃的产出  
• 上下⽂连续：每个对话保持完整的聊天历史，Agent能基于历史消息理解上下⽂，⽀持多轮迭代修改  
• 产物内联：Agent的回复不仅是⽂字，还可以内联展⽰代码Diff、⽹⻚预览卡⽚、⽂件附件等富媒体产物，⽤⼾可直接在聊天流中预览和操作

平台同时接⼊市⾯主流 Agent 平台（Claude Code、Codex、OpenCode 等），通过统⼀的适配器层屏蔽API差异，并⽀持⽤⼾⾃建Agent。所有Agent产出（代码、⽹⻚、⽂档、PPT等）⽀持实时预览、代码⼆次编辑和⼀键部署发布。

# 核⼼功能

# 1.IM聊天式交互（核⼼体验）

<table><tr><td>功能</td><td>说明</td></tr><tr><td>对话列表</td><td>左侧会话列表,支持新建/置顶/归档/搜索,按最近活跃排序</td></tr><tr><td>单聊模式</td><td>1v1 与单个 Agent 对话,适合明确任务(如"用 Claude Code 写一个 React 组件")</td></tr><tr><td>群聊模式</td><td>一个对话中包含多个 Agent,通过 @ 指定或由 Orchestrator 自动分派,Agent 依次回复</td></tr><tr><td>消息类型</td><td>文本、代码块、图片、文件附件、网页预览卡片、Diff 视图卡片、部署状态卡片(可选)</td></tr><tr><td>消息操作</td><td>回复、引用、重新生成、复制代码、一键应用 Diff、展开预览</td></tr><tr><td>上下文管理</td><td>聊天历史自动作为上下文传递给 Agent,支持手动 pin 关键消息作为长期上下文</td></tr></table>

# 2. 主 Agent 协调器（Orchestrator）

• 在群聊模式下，⾃动理解⽤⼾意图，将复杂任务拆解并分派给合适的⼦ Agent  
• ⼦ Agent 完成后，Orchestrator 聚合产出并在聊天流中汇报结果  
. ⽀持并⾏调度、失败降级、代码冲突处理

# 3. 多 Agent 接⼊

• 统⼀适配器层，⾄少接⼊ 2 个主流 Agent 平台（Claude Code + Codex / OpenCode）  
• ⽀持⽤⼾⾃建 Agent（对话式创建，设定 System Prompt + ⼯具集）  
每个Agent在聊天列表中显⽰为独⽴的"联系⼈"，有头像、名称、能⼒标签

# 4.产物预览与编辑

• Agent回复中内联产物预览卡⽚（⽹⻚iframe、⽂档渲染、【P2】PPT浏览）  
• 点击卡⽚展开全屏预览/代码编辑器  
• 【P2】⽀持Diff视图、版本历史、对话式局部修改（选中代码→在聊天中描述修改）

# 【P2】5.部署发布

• 聊天中直接发送"部署"指令，Agent返回部署状态卡⽚   
. ⼀键⽣成预览URL/静态站点部署/容器化部署/源码打包下载

# 【P2】6.多端⽀持

<table><tr><td>平台</td><td>定位</td></tr><tr><td>Web 端</td><td>主力端,完整 IM 体验 + 代码编辑 + 全功能</td></tr><tr><td>桌面端</td><td>本地文件访问、系统通知、Agent 进程管理</td></tr><tr><td>移动端</td><td>轻量 IM 体验:查看对话、审批确认、产物预览</td></tr></table>

考察要点

<table><tr><td>维度</td><td>权重</td><td>评判要点</td></tr><tr><td>AI 协作能力</td><td>30%</td><td>沉淀出和ai协作的Spec、skill、rules等协作规范</td></tr><tr><td>功能完整度</td><td>25%</td><td>IM 核心体验是否流畅、多 Agent 调度是否跑通</td></tr><tr><td>生成效果质量</td><td>20%</td><td>聊天 UI 体验、产物预览效果</td></tr><tr><td>代码理解度</td><td>15%</td><td>答辩时能否解释架构选型和核心逻辑</td></tr><tr><td>创新与产品感</td><td>10%</td><td>超预期功能点或体验优化、详细的产品设计方案</td></tr></table>

交付物：产品设计⽂档+技术⽂档+可运⾏Demo+AI协作开发记录 +3分钟Demo视频