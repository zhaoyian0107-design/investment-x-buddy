# 投资 X Buddy 第二版交付

公网产品：https://investment-x-buddy-production-525b.up.railway.app/

源码仓库：https://github.com/zhaoyian0107-design/investment-x-buddy

2026-10-10 已完成 Railway Docker 构建、云端 MySQL 9.7.2、公网主链路、异常与重启恢复验收。完整访问说明见 PUBLIC_DELIVERY.md。

完整项目：investment-x-buddy-v2.zip。包含源码、构建产物、测试、启动说明、MySQL／Docker Compose、六项验收报告、本轮截图、约128秒操作视频及独立证据包。

1. 解压后进入含 package.json 的目录。
2. 安装 Node.js 24+；执行 npm.cmd ci。
3. 默认演示可直接 npm.cmd start；访问 http://127.0.0.1:3000。
4. 需要开发时 npm.cmd run dev；修改前端后 npm.cmd run build 再启动生产版。
5. MySQL 与 Compose 配置见 README.md；真实账号凭据在本机 .env 填写。

验收：47/47自动测试；生产构建；实际 MySQL 8.0.46 主链路、预算与证据；26条证据／8条算式独立复算；桌面和390像素窄屏。

主要记录：

- docs/V2_ACCEPTANCE.md：六项修改及验收指标、文件映射、边界。
- outputs/v2-test-result.txt：完整测试输出。
- outputs/v2-mysql-test-result.json：实际数据库测试。
- outputs/v2-sample-bundle.json 和 v2-bundle-verification.json：独立复算样例与校验输出。
- outputs/v2-browser-test-result.json 和 v2-a11y.json：浏览器与可访问性检查。
- outputs/v2-demo.webm：本轮实际操作视频，构造数据演示。
- docs/AI_USAGE.md：AI参与范围、发现和验证修正。

打包排除 node_modules、.env、凭据、运行数据库、临时测试实例及第一版演示成果。原版源码备份单独保留，数据库备份仅在本机。项目内已有真实研究数据不会随源码包对外分发。

真实供应商账号、iFinD 原文网关和本机 Docker Compose 编排仍未验收；演示数据与规则模型明确标注。公网 URL、公开源码仓库及云端 Docker 容器已经实际验收。
