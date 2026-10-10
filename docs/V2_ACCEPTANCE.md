# 第二版逐项改造与验收

验收日期：2026-10-10（Asia/Shanghai）。范围：本地可运行项目、SQLite / MySQL、已实现的数据／模型契约。真实账号和公网部署另列边界，不以模拟测试替代。

## 结论

六项修改已落地并通过本地验收。最终回归47项通过、0失败、0跳过；实际 MySQL 8.0.46 的隔离实例通过；生产构建通过；独立示例证据包含26条证据和8条算式，复算通过。浏览器与视频记录见 outputs 下的 v2 文件。

| 项目               | 交付改造                                                             | 必须满足的验收条件                                                                                                 | 证据                                                                                             |
| ------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| 1 执行授权         | 所有执行入口使用当前计划、版本、预算和到期授权；拒绝审批恢复正确状态 | 拒绝初始审批后 retry/resume 返回409且不调用；旧版本不能执行新版；拒绝扩展不恢复运行                                | tests/api.test.ts、tests/ledger.test.ts                                                          |
| 2 调用账本         | 独立预占、发起、结算；并发事务、幂等键、未知费用与重启恢复           | 最后一次预算的两个并发追问只发一次；供应商收到请求后进程退出仍计费；相同键不能重发；旧聚合保存不能抹去用量         | tests/concurrency.test.ts、tests/ledger.test.ts、v2-mysql-test-result.json                       |
| 3 依赖与完成标准   | 根据所选指标获取必需字段；缺字段任务重取；注册完成检查器             | 缺现金流后重试会重新取数并完成；只看收入不依赖现金流；自定义未支持要求保持 partial；执行结束和目标达成分别显示     | tests/api.test.ts、v2-smoke-result.json                                                          |
| 4 不可变证据       | 内容哈希、源快照、独立表、历史读取、实际引用与独立 bundle            | 刷新同报告期产生新 ID，旧值不变；新计划仍能读旧证据；别的会话读不到；篡改与快照缺失校验失败；8条算式可独立复算     | tests/evidence.test.ts、tests/api.test.ts、v2-bundle-verification.json                           |
| 5 反证与修订       | 核心判断→改变条件→定向材料→支持／反向／限制／无关→收窄判断           | 构造限制附注产生 before/after 修订；无关材料不充当反证；摘录必须在原文中找到；核心覆盖不完整不能称完成             | tests/api.test.ts、v2-preview-counter-source.png、v2-demo.webm                                   |
| 6 上下文与验证体验 | 近期对话、用户纠正、事实引用、修订摘要；真实检查状态与迁移           | “刚才”能延续前次回答；用户纠正标为未验证；实际请求携带近期对话和纠正；中文数字与确定性措辞被剔除；旧验证降为待检查 | tests/context.test.ts、tests/concurrency.test.ts、tests/claims.test.ts、tests/migrations.test.ts |

## 1. 授权边界

入口和请求发起处都检查授权。预占时批准、发起时计划改变也会拦截。审批指纹包含规范化计划、版本、指标、公开材料范围、完成标准、有界核查政策和预算。规划有独立的一次模型调用权限；创建计划可能先产生规划调用，执行取数仍需确认，规划调用计入项目总预算。

主要文件：server/policy.ts、server/index.ts、server/calls.ts、server/store.ts。

## 2. 账本边界

call_ledger 是用量来源，不依赖 Project JSON 能否提交。reserved 占用调用额度；started 之前再次检查版本与授权；成功、已知响应失败、结果未知均保留已发生尝试。响应无法确认时保守计入次数，Token 和成本未知单独显示。

同一请求键只记录一次；网页在失败后重发同一文本会沿用请求编号。未知请求不自动重发。任务恢复是新的尝试，可以再次调用供应商，因此不承诺供应商的 exactly-once。已提交任务结果复用。未发出预占在60秒后不能发起，下一次预占或服务恢复释放。

主要文件：server/calls.ts、server/store.ts、server/model.ts、server/data.ts。模型输入字符数记录在每次调用中，不把摘要字符缩减误称 Token 节省。

## 3. 完成检查

指标依赖：revenue→收入；netProfit→归母净利润；operatingCashflow→经营现金流；cashConversion→净利润+经营现金流。缺失值始终保留 null，不能补零。用户手动重试使用新尝试编号，重新取缺字段任务，保留成功的其他任务。

自动完成要求只支持四个明确模板：必需字段齐全、原始字段与计算依赖、判断分类、反证与缺口记录。文本不能仅凭包含“核心指标”等关键字就被误认成已检查。应收、存货、季度或用户自定义阈值等未接入要求保持 unresolved。研究计划中可改选已注册标准，保存后重新确认。

executionFinished 仅表示运行结束；outcome=met 与无缺口才进入 completed。算式检查“不适用”和金融解释“需审阅”分别显示。

主要文件：server/planning.ts、server/data.ts、server/engine.ts、shared/types.ts、src/AuditPanels.tsx。

## 4. 证据链

证据身份包括数值、报告期、单位、源记录、采集时点、计划版本、算法与输入引用；原材料快照分别存储。扶摇响应 body 和额外字段保留，认证头不入库。现金流原文链接使用现金流接口，字段公开时间分别保留。

bundle 包含报告、完成检查、当前计划和审批、账本、反证关系、修订、上下文、所有持久化证据和快照。校验清单哈希、证据身份、快照引用、公式输入、对象／期间／单位、数值、判断引用和逐字摘录。MySQL 精确文本封装消除浮点重序列化导致的身份漂移。

```powershell
node scripts/verify-bundle.mjs outputs/v2-sample-bundle.json
```

此命令不连接数据库或模型，也不需要 node_modules。依赖 Node.js 24 内置 TypeScript 类型剥离及项目 shared 校验文件。SHA-256 能检查包内一致性，不能证明材料来源真实，亦不提供数字签名。

主要文件：server/evidence.ts、server/export.ts、shared/bundle.ts、shared/canonical.ts、scripts/verify-bundle.mjs。

## 5. 针对判断的核查

目前核心假设是“较高现金利润比是否支持经营质量持续改善”。核查问题、改变判断的条件、检索 query、截止日、来源、审阅份数、逐字摘录、定位和关系均记录。每份材料只接受一项关系记录，重复 ID 不能伪装覆盖全部材料。

演示模式使用明确标注的构造附注和无关新品材料；真实模式需要原文网关和模型。没有材料、模型或定位检查未通过，status 保持 unavailable。自动关系评估仍需审阅。已发现限制使判断收窄并留存修订，不能据此证明因果。

主要文件：server/counterchecks.ts、server/research.ts、server/engine.ts、src/AuditPanels.tsx。

## 6. 上下文、状态与迁移

摘要保留带引用事实、当前判断、修订前后、近期对话、未验证用户纠正与研究边界，跨计划版本不混用近期对话。追问保存模型实际选中的引用，检索候选集不能全部冒充实际引用。财务模型输入不携带整份原始传输 body；原证据在数据库中保留。

旧研究数据升级时保留报告和历史，用量单列为 legacyUsage；撤销旧批准，运行中项目暂停，原版绿勾改为 not_checked。用户修改计划保存新版本后才能重新确认执行。迁移不会声称旧研究已经重新验收。

主要文件：server/context.ts、server/migrations.ts、server/index.ts、src/App.tsx、src/AuditPanels.tsx。

## 已知边界

- 默认构造数据，所有公司数值与材料并非真实财报；协议测试不代表真实账号线上成功。
- 最多一轮、两项现金支撑核查。三公司范围可能因为第三家未覆盖保持部分成果；扩大轮次／工具仍需后续能力开发。
- 无真实模型、扶摇 Key 或 iFinD 网关，不验收真实数据真实性、权限与费用；无原文配置时明确降级。
- 本机未安装 Docker，未验证本机 Compose 编排；配置已交付，本地 MySQL 测试为8.0.46，Compose 示例为8.4。追加的 Railway 云端 Docker 构建及 MySQL 9.7.2 实际运行已通过公网验收。
- 本地单服务、单 Worker；身份为签名 Cookie，不是正式账号体系、分布式队列或交易产品。
- JavaScript number 不等同会计高精度 Decimal；保留原始数值、精确序列化及计算容差。
- 公网 URL 与公开 GitHub 仓库已在本地六项验收之后创建并通过实际验收，见 [PUBLIC_DEPLOYMENT.md](PUBLIC_DEPLOYMENT.md)。`outputs/v2-acceptance.json` 是02:52 UTC时本地验收快照，其中公网尚未创建的历史状态由后续 public-*.json 记录补齐。

## 原版保留

改动前源码：work/v2-backup/source-v1.zip。改动前一致性 SQLite 副本：work/v2-backup/buddy-v1.sqlite（仅本机，不进入提交包）。当前 data 数据保留；切回旧源代码时应使用备份数据库，避免旧程序沿用新版表结构和状态。
