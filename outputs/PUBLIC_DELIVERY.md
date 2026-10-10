# 投资 X Buddy 公网交付

产品 URL：<https://investment-x-buddy-production-525b.up.railway.app/>

源码仓库：<https://github.com/zhaoyian0107-design/investment-x-buddy>

无需注册或访问口令。打开产品后选择“比较利润的现金支撑”，点击“建立研究计划”，检查范围和预算，点击“确认计划，开始研究”；完成后可点击指标和证据引用，查看计算依赖、反证、判断修订，下载证据包或导出成果。

产品运行在 Railway 云端 Docker 容器并连接内网 MySQL，电脑关机后仍可访问。签名 Cookie 区分个人空间；同一个浏览器可恢复研究，清除 Cookie 或换设备会创建新空间。

实际公网验收记录：

- `public-smoke-result.json`：主链路、审批、完成检查、反证与修订、证据与记忆隔离；26条证据、8条算式独立复算通过。
- `public-restart-result.json`：实际重启云端应用后，同一会话仍可读取原项目、证据与记忆，证据包校验通过。
- `public-resilience-result.json`：过期数据明确降级；预算耗尽停止、扩展待审批及拒绝时不执行；三个已完成任务在云端重启后复用，恢复后证据包通过。
- `public-browser-result.json` 和 `public-*.jpg`：浏览器实际操作及截图。
- `v2-demo.webm`：约128秒演示视频；构造数据演示。

说明：线上 DATA_MODE=demo、MODEL_MODE=demo，所有公司数字和材料为构造样本。真实模型、真实金融数据及 iFinD 尚未进行真实账号线上验收。自动复算验证引用、数据完整性和算式，不证明原始材料真实性或投资解释正确。

完整项目 ZIP 包含源码、生产构建、测试、README、MySQL 与 Compose 配置、演示视频、AI使用记录和验收材料，排除密钥、用户研究数据库、依赖与临时文件。ZIP小于题目30MB限制。

Railway 使用账户试用额度，未购买域名或付费升级。评审期间需保持应用、数据库和工作区额度有效，费用及到期时间以平台页面为准。
