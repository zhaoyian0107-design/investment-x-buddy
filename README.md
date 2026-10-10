# 投资 X Buddy · V2

一个能检查证据、保存状态并从中断处继续工作的个人投资研究工作台。

**公网产品：[打开投资 X Buddy](https://investment-x-buddy-production-525b.up.railway.app/) · 无需登录即可创建独立研究空间。**

源码：[GitHub 仓库](https://github.com/zhaoyian0107-design/investment-x-buddy)。使用明确标注的构造数据与规则演示；真实数据和模型需另行配置并验证。

主场景：比较公司在可比年度报告期中的收入、归母净利润、经营现金流与现金利润比，保留支持证据、反证、局限和下一步研究问题。

第二版已逐项完成六项改造：统一执行授权、独立调用账本、指标依赖与完成检查、不可变证据与复算导出、针对判断的反证与修订、语义上下文与真实验证状态。详细修改点、验收条件和证据见 [V2_ACCEPTANCE.md](docs/V2_ACCEPTANCE.md)。

最终自动测试 **47/47 通过**；实际 MySQL 8.0 独立实例通过预算并发、迁移与完整主链路测试；示例证据包 **26 条证据、8 条算式**通过独立复算。原版源文件已备份，旧研究数据保留并撤销旧授权。

**交付状态：已部署至 Railway，HTTPS 产品与公开源码仓库均可访问。云端 Docker 构建和 MySQL 9.7.2 实际主链路、异常降级、审批边界及重启恢复通过验收。本地仍支持 SQLite / MySQL 8。真实模型和扶摇适配已实现，真实账号调用尚未验收。**

## 1. 立即启动

需要 Node.js 24+。默认不需要数据库服务或 API Key。

```powershell
npm.cmd ci
npm.cmd run dev
```

打开 <http://127.0.0.1:3000>。开发和生产均使用同一个端口，避免跨域会话问题。

本机已有依赖和生产构建时，也可双击项目根目录的 `start-local.cmd`。它检查服务是否已启动，必要时在后台启动并打开浏览器；重复双击不会重复启动。电脑重启后需再次双击。运行日志在 `work/local-service-3000.*.log`。这个地址仅供运行项目的电脑访问；未部署到公网前，其他设备无法通过该地址访问。

生产构建：

```powershell
npm.cmd run build
npm.cmd start
```

首次运行自动创建 `data/buddy.sqlite` 和本地会话签名文件。应用重启后项目、证据、记忆和检查点保留。默认监听本机；需要网络访问时配置 `HOST=0.0.0.0`。

## 2. 建议体验路径

1. 首页选择“比较利润的现金支撑”，或输入明确研究问题。
2. 在研究计划中检查公司、年度、截止日和指标，修改后保存。
3. 确认计划。系统执行对象核对、财务取数、材料核查、指标计算与成果生成。
4. 点击指标、结论引用或右侧证据索引，查看来源、公开时间、原始字段、算式与依赖。
5. 追问“为什么较高现金利润比不足以证明经营质量更好？”查看相关证据与研究边界。
6. 查看运行记录中的调用预算、事件、上下文摘要和检查点。
7. 在长期记忆中确认一条研究偏好。下一次新建项目会读取它。
8. 在新计划的高级设置中选择中断或接口异常，观察恢复和降级。

演示模式支持美的集团、格力电器、海尔智家及 2023/2024 年度。**所有演示数字与文本都由项目构造，不是这些公司的真实财报。**

## 3. MySQL 部署

已发布评审可实际操作的公网 URL 和源码仓库。云端 MySQL 使用内网连接及应用专用账号，未开放数据库公网端口。部署与验收步骤见 [PUBLIC_DEPLOYMENT.md](docs/PUBLIC_DEPLOYMENT.md)，实际结果见 [公网主链路](outputs/public-smoke-result.json)、[重启验收](outputs/public-restart-result.json)、[异常与恢复](outputs/public-resilience-result.json)。

### 使用已有 MySQL 8

执行 `deploy/mysql-init.sql`，先替换其中密码并调整应用主机授权。使用应用专用账号，不把管理员账号用于产品。

将 `.env.example` 复制为 `.env`，设置：

```dotenv
DATABASE_URL=mysql://buddy:URL_ENCODED_PASSWORD@127.0.0.1:3306/investment_buddy
SESSION_SECRET=REPLACE_WITH_A_LONG_RANDOM_SECRET
```

密码包含 `@`、`:`、`/` 等字符时必须 URL 编码。`SESSION_SECRET` 在 MySQL 部署时必填且应跨重启保持不变。

应用首次启动创建 `projects`、`memories`、`worker_lease`、`call_ledger`、`source_snapshots`、`evidence_records` 和 `schema_versions`。项目、任务和检查点使用受 revision 约束的聚合；请求预算、费用和证据分别持久化，旧项目写入不能覆盖已经发生的费用。MySQL 的项目、快照和证据 payload 在 JSON 列中使用 JSON 字符串保存精确序列化文本，防止二进制 JSON 重编码浮点数末位导致证据哈希变化。

### Docker Compose

安装 Docker / Docker Compose 后，在 `.env` 中配置：

```dotenv
MYSQL_PASSWORD=REPLACE_WITH_A_RANDOM_ALPHANUMERIC_PASSWORD
MYSQL_ROOT_PASSWORD=REPLACE_WITH_A_DIFFERENT_RANDOM_PASSWORD
SESSION_SECRET=REPLACE_WITH_A_LONG_RANDOM_SECRET
DATA_MODE=demo
MODEL_MODE=demo
PORT=3000
```

Compose 的 URL 插值建议使用字母数字密码，避免连接串编码歧义。

```powershell
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 app
```

访问 <http://127.0.0.1:3000>。MySQL 不映射宿主机端口；数据保存到 `mysql_data` 卷。普通容器重启不会清空研究。

外部访问时设置 `APP_BIND=0.0.0.0`，配置访问口令 `APP_ACCESS_TOKEN`，使用 HTTPS 反向代理并设置 `COOKIE_SECURE=true`。`deploy/nginx.conf` 提供代理与 SSE 配置示例。正式多人产品还需要独立账号体系；当前以签名 Cookie 隔离研究空间。

本机已经完成 MySQL 8.0 的独立实例实际测试；Railway 实际 Dockerfile 构建、容器运行和 MySQL 9.7.2 验收也已通过。**此电脑未安装 Docker，本机 Compose 容器编排仍未验证。**

## 4. 真实数据与模型

### 扶摇直接接入

后端实现官方 REST 契约，无需另建财务网关：

```dotenv
DATA_MODE=live
DATA_PROVIDER=fuyao
FUYAO_API_KEY=
```

在你自己的本地环境文件中保存有效扶摇凭据。接口：

- `/api/meta/tickers/search`：核对公司代码与名称。
- `/api/a-share/financials/income-statements`：营业收入与归母净利润。
- `/api/a-share/financials/cash-flow-statements`：经营现金流。

使用 `period=annual`，按年度区间查询。读取 `operating_income`、`parent_holder_net_profit`、`act_cash_flow_net`，保留原始记录和 `request_id`。公开时点以 `report_date_ms` 转换，按 Asia/Shanghai 与截止日比较。HTTP 200 不代表业务成功，必须检查 `code`。

来源：[扶摇财务报表官方文档](https://fuyao.aicubes.cn/docs/api-reference/financials/)、[标的检索](https://fuyao.aicubes.cn/docs/api-reference/ticker-search/)。

公告／原文通过可配置网关接入，契约见 [DATA_ADAPTER.md](docs/DATA_ADAPTER.md)。未配置原文能力时明确显示缺口，不伪造公告。iFinD MCP 需要按实际授权工具编写到此网关的适配；本项目没有宣称已调用 iFinD。

### 模型接入

```dotenv
MODEL_MODE=live
MODEL_API_STYLE=responses
MODEL_BASE_URL=https://api.openai.com/v1
MODEL_NAME=
MODEL_API_KEY=
MODEL_INPUT_USD_PER_MILLION=
MODEL_OUTPUT_USD_PER_MILLION=
```

选择账号实际可用的模型。支持 Responses API 结构化输出，以及 `MODEL_API_STYLE=chat` 的兼容接口；后者也需要支持 `json_schema`，不支持时明确降级。

模型负责研究计划、证据解释、针对材料的关系评估和追问；财务算式、权限、审批、预算和状态机由代码负责。模型失败时显示规则降级状态。事实数字由代码模板输出；模型解释检查阿拉伯数字、常见中文金额／比例、建议与无依据确定性措辞。引用存在、算式通过与金融解释正确分别标记，解释始终需审阅。

实现契约依据 [OpenAI Structured Outputs 官方文档](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)。凭据只保留在服务端，不使用 `VITE_*` 存放密钥，不写入 Git。

## 5. Harness 设计

- 注册能力：参数／输出契约、权限、超时、可用状态。
- 受约束规划：最多三家公司、三个年度、四种核心指标；工具名称白名单。
- 后台执行：Worker 从数据库寻找运行任务，客户端仅订阅 SSE 状态。
- 检查点：任务输出、证据和完成状态一次保存，已提交结果可复用。
- 恢复：签名会话与持久化状态跨重启保留；异常退出后等待旧租约过期，默认最多约 15 秒，再恢复未提交任务。
- 执行语义：请求先原子预占，再核验当前授权并记录发起，最后结算。相同请求键拒绝重复发起；进程中断时已发起请求仍收费并标为结果未知。恢复任务是新的尝试，可能再次请求供应商，但每次均计入账本。未发出的预占最多占用60秒，过期后不能发起。
- 审批：授权指纹包含规范化计划、版本和预算，修改范围使旧审批失效。
- 停止：模型调用、工具尝试、累计耗时上限；扩展预算先确认再执行。
- 压缩：保留近期六条对话、用户纠正、带引用事实、判断修订和研究边界；用户纠正标为未验证，不自动升级为事实。记录实际模型输入字符数与供应商 Token，两者不混用。
- 记忆：用户明确确认的偏好／假设，按会话隔离并可删除。
- 版本：修改计划保存历史计划、任务、证据、成果与检查点快照。
- 可观测性：实际状态事件、尝试次数、耗时、模型 usage；无法获得的成本标为未知。

详见 [ARCHITECTURE.md](docs/ARCHITECTURE.md) 和 [PRODUCT.md](docs/PRODUCT.md)。

## 6. 验证

```powershell
npm.cmd run check
npm.cmd run build
npm.cmd test
# 应用已启动时执行一次独立主链路冒烟测试
npm.cmd run test:e2e
# 示例证据包可脱离数据库独立复算，无需 API Key
npm.cmd run verify:bundle -- outputs/v2-sample-bundle.json
# 对已部署的公网服务执行验收（会创建独立验收研究）
$env:PUBLIC_BASE_URL='https://investment-x-buddy-production-525b.up.railway.app'
npm.cmd run test:public
npm.cmd run test:public:resilience
# 在平台重启应用并等待健康后，复用重启前的验收会话
npm.cmd run test:public -- --resume
npm.cmd run test:public:resilience -- --resume
# 使用现有 MySQL 二进制启动隔离测试实例，不修改现有服务
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-mysql.ps1
```

MySQL 不在默认路径时传入 `-MySqlBin '你的MySQL bin目录'`。测试实例只绑定本机动态端口，数据写在 `work/mysql-test-*`，结束后停止匹配该数据目录的测试进程。

测试说明：[TESTING.md](docs/TESTING.md)。真实付费模型和真实数据账号尚未调用验证，不能把协议模拟测试当成供应商线上验收。

公网服务使用 Railway 试用额度，评审期间需保留应用和数据库，留意余额及到期时间。电脑关机不会停止云端服务。

## 7. 边界与未做事项

- 第二版聚焦年度经营质量，不覆盖整个投资研究领域或自动交易。
- 现金支撑核心假设最多一轮、两项有界核查；三家公司研究可能因第三家未被覆盖保持部分成果。预算扩展不自动扩大工具或核查轮次。
- 完成标准只自动检查已注册的四类要求。自定义目标、应收／存货／季度等未接入要求保持未达成，不能用任务执行结束冒充研究目标达成。
- 原文检索覆盖率与财务可比性需要人工审阅，自动引用校验不证明因果成立。
- 以 JavaScript number 计算，并展示常用财务量级；不是高精度会计账簿。
- 单个 Worker 串行调度，适合个人工作台；高并发需要拆分队列和分片租约。
- 没有正式账户注册、跨设备账号同步、向量检索或付费订阅。
- Cookie 清除后进入新空间；需要长期多设备使用时增加认证账号和恢复入口。
- 真实凭据、iFinD 原文适配、公网 URL 和远端仓库地址仍需部署阶段补齐。

## 8. 交付与提交

`outputs/v2-demo.webm` 是本轮实际录制的约128秒无声操作视频，覆盖计划修改与重新确认、指标依赖、限制材料原文、判断修订及调用账本。追问、异常和真实进程中断另由浏览器记录与自动测试验证。讲解提纲见 [DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md)。

```powershell
npm.cmd run package:submission
```

生成 `outputs/investment-x-buddy-v2.zip`，自动排除密钥、依赖和运行数据库，检查小于 30MB。压缩包包含完整源码、构建产物、README、六项验收报告、设计、AI 使用记录、测试说明、MySQL／Compose 配置及本轮截图与视频。

交付清单见 [V2_DELIVERY.md](outputs/V2_DELIVERY.md)。当前是可运行本地项目；公网 URL、远端源码仓库和真实账号验收仍需部署阶段补齐。
