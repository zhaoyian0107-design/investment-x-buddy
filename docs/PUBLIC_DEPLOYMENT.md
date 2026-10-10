# 公网部署与笔试交付

状态：2026-10-10 已实际部署并完成公网验收。

- 产品：<https://investment-x-buddy-production-525b.up.railway.app/>
- 源码：<https://github.com/zhaoyian0107-design/investment-x-buddy>
- 访问：无需注册或口令。签名 Cookie 区分独立研究空间；清除 Cookie 后进入新空间，尚无跨设备账号同步。
- 运行：Railway 云端 Docker 容器，Node.js 24，MySQL 9.7.2；单应用副本，关闭应用休眠。候选人的电脑无需保持开机。
- 模式：DATA_MODE=demo、MODEL_MODE=demo。数字、材料和模型解释为明确标注的构造演示，不宣称真实供应商已接通。
- 数据库：内网连接；buddy_app 仅有 railway 库的 SELECT、INSERT、UPDATE、DELETE、CREATE、INDEX 权限，无全局管理权限。数据库未创建公网 TCP Proxy。
- 密钥：数据库连接串和稳定 SESSION_SECRET 存放于平台变量，未写入源码。临时部署 SSH 公钥已撤销。

## 当前推荐路径

使用 Railway 运行现有 Dockerfile，并在同一个项目中创建 MySQL 服务。保留目前的 Express 后端、后台任务和持久化机制。不要只发布 dist 静态文件；这样会缺少审批、执行、证据和记忆接口。

用户先在 https://railway.com/login 注册并登录。账号验证和支付步骤由用户本人完成；不要在聊天中发送密码、银行卡信息、私钥或 API Key。先检查账户试用资格、网络限制和费用，再创建资源。

## 发布步骤

1. 将源代码发布到用户的 GitHub 仓库，排除 .env、data、work、node_modules 及用户数据。给评审提供可访问的仓库 URL 和 README。
2. 创建 Railway 项目，添加 MySQL 服务，并确认持久卷。通过 MySQL 内网连接；不要为数据库开启公网端口。
3. 新建应用服务，连接源码仓库或通过官方 CLI 上传经过排除私密文件的源码。根目录的 railway.json 使用 Dockerfile 构建、/api/health 检查和故障重启，应用只运行一个副本。
4. 在平台的环境变量界面配置：

   | 变量 | 配置 |
   | --- | --- |
   | HOST | 0.0.0.0 |
   | PORT | 3000（生成域名的目标端口也设为3000） |
   | DATABASE_URL | MySQL 内网连接串；生产使用应用专用账号，不把管理员密码写进源码 |
   | SESSION_SECRET | 随机生成并跨重启保留的强密钥 |
   | COOKIE_SECURE | true |
   | DATA_MODE / MODEL_MODE | demo；真实调用只有在有效凭据配置并实测后才切换 live |
   | APP_ACCESS_TOKEN | 可选评审访问口令；如启用，在提交说明中告知评审 |

5. 部署成功后在应用 Settings → Networking → Public Networking → Generate Domain 生成公网 HTTPS URL。将真实 URL 写入 README 和提交说明，不填写虚构地址。
6. 在实际公网 URL 上完成下列验收，并记录日期、应用版本、部署记录和结果。

## 上线验收

- 无需候选人的电脑开机，另一台设备可以打开 HTTPS 首页。
- /api/health 返回 ok=true、database=mysql、version=2.0.0；生产静态资源和会话接口正常。
- 新建研究 → 检查计划 → 确认 → 执行 → 查阅证据、算式及反证 → 导出证据包，全流程可实际操作。
- 两个独立浏览器会话不会读取对方项目或证据。
- 关闭网页后执行继续；重新打开恢复状态。重启云端应用后，原会话的项目、证据和记忆仍可读取。
- 故障注入、停止与恢复正常；演示数据和规则模式标识仍清楚可见。
- 在评审使用期内保留服务和数据库；关注平台额度到期与资源费用，不能将短期试用称为永久免费部署。

最终交付包括真实产品 URL、源码仓库 URL、访问说明、演示视频及公网验收记录。本地47项测试结果继续保留，不能用它代替公网验收。

## 实际验收记录

`outputs/public-smoke-result.json`：HTTPS 首页及静态资源、MySQL 健康接口、审批拒绝后不执行、确认后完成研究、完成标准及检查点、反证和判断修订、项目和证据会话隔离、导出与独立复算、记忆隔离。26 条证据、8 条算式通过。

`outputs/public-restart-result.json`：官方 CLI 实际重启应用后，同一签名会话可读取原项目、证据及记忆，证据包复算仍通过。

`outputs/public-resilience-result.json`：过期数据产生部分成果和3项缺口；1次工具预算耗尽后停止，扩展未批准或被拒绝时不能继续，批准后完成；中断项目保存3个已完成任务，真实云端重启后继续，三个任务的尝试次数未增加，恢复的证据包通过复算。

验收脚本在 scripts/public-smoke.ts 与 scripts/public-resilience.mjs 中；重启前会话保存在被 Git 排除的 work 目录，不能公开该文件。截图见交付包 outputs/public-*.jpg。

## 维护

Railway 当前 CLI 提示 railway.json 将于2026-12-01停止受支持；本次配置已实际生效。长期维护应按平台官方迁移说明转到 Infrastructure as Code；不要把这项后续工作记作已完成。

试用额度和到期时间以用户工作区实际页面为准。没有启用付费升级、购买域名或续费。评审结束前保持应用和 MySQL 在线。

参考：[MySQL](https://docs.railway.com/databases/mysql)、[公网域名与HTTPS](https://docs.railway.com/networking/public-networking)、[配置文件](https://docs.railway.com/config-as-code/reference)、[试用与限制](https://docs.railway.com/pricing/free-trial)、[费用](https://docs.railway.com/pricing/plans)。
