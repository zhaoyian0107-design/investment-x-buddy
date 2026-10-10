# 数据适配与协议

## 已实现：扶摇 REST

官方资料：[财务报表](https://fuyao.aicubes.cn/docs/api-reference/financials/)、[标的检索](https://fuyao.aicubes.cn/docs/api-reference/ticker-search/)。核对日期：2026-10-10（Asia/Shanghai）。

Base URL 为 `https://fuyao.aicubes.cn`，认证使用服务端 `X-api-key`。财务接口金额为人民币元，年报使用 `annual`；实际读取归母利润字段 `parent_holder_net_profit`，不误用总净利润。报告公开日期使用 `report_date_ms`。

上游 `code != 0` 即失败，包括 HTTP 200 的权限错误；`5002/5003` 允许预算内重试。缺失字段保留 null。第二版保留原始响应 body、请求 URL／request_id 和额外字段；不会保存认证请求头。现金流字段使用现金流接口链接和对应公开时间。只选择收入时不会依赖现金流表；现金利润比仍必须取得利润与现金流两项输入。

真实 Key 未提供，因此当前仅完成官方契约适配与模拟协议测试，未验收真实账号权限及在线财务值。

## 扩展网关

公告／原文和其他数据供应商以规范化网关隔离。不是假定供应商自带以下端点。你需要自行实现网关，内部调用实际可授权的 iFinD MCP 或其他数据工具。

配置 `DATA_GATEWAY_URL`，服务端发送 `Authorization: Bearer DATA_GATEWAY_TOKEN`。网关应验证访问令牌、上游权限、可公开保存范围，不能把供应商 Key 返回产品。

### POST /v1/resolve

输入：

```json
{ "entities": [{ "code": "000333.SZ", "name": "美的集团" }] }
```

输出：匹配授权对象的同结构数组。若名称与代码不一致，产品阻止后续执行。

### POST /v1/financials

仅在 `DATA_PROVIDER=gateway` 时使用。输入 entity、years、asOf、period，输出规范化数组：

```json
[
  {
    "code": "000333.SZ",
    "name": "美的集团",
    "year": 2024,
    "period": "annual",
    "currency": "CNY",
    "unit": "yuan",
    "revenue": null,
    "netProfit": null,
    "operatingCashflow": null,
    "publishedAt": "2025-04-20T00:00:00.000Z",
    "retrievedAt": "2026-10-09T16:00:00.000Z",
    "source": "YOUR_AUTHORIZED_SOURCE",
    "sourceRecordId": "ORIGINAL_ID",
    "mode": "live"
  }
]
```

以上只是 null 值协议结构示例，不是实际财务结果。每条记录公开时点不得晚于研究截止日。采集时间须在当前24小时内；该校验针对快照刷新，不把年度财报本身的年龄当作过期。

### POST /v1/filings

普通取数输入 entity、years、asOf；针对判断的核查还携带 claimId、question、query。网关按这些条件检索，不能提供预设结论代替原文。输出：

```json
[
  {
    "code": "000333.SZ",
    "title": "YOUR_SOURCE_TITLE",
    "publishedAt": "2025-04-20T00:00:00.000Z",
    "text": "SOURCE_EXCERPT",
    "source": "YOUR_AUTHORIZED_SOURCE",
    "sourceRecordId": "ORIGINAL_ID",
    "sourceUrl": "https://your-permitted-source.example/document",
    "mode": "live"
  }
]
```

没有结果返回空数组，产品记录检索缺口。原文不能包含网关凭据。`DATA_ALLOWED_SOURCE_HOSTS` 可限制来源链接域名。

每份摘录最多12000字符。模型关系分为 supports、contradicts、limits、irrelevant；引用必须逐字出现在已取回材料中，并保留正文字符位置。没有模型时材料可以保存，但语义核查保持 unavailable；未检索到不能解释为不存在。

## 数据质量规则

非法单位、错误对象、重复同年记录、未知公开时点、未来公开数据、失效采集时间与数据模式混淆均被拒绝。真实模式从不调用 demoRows 代替失败财务结果。

若供应商不允许持久化原文，应让网关提供允许保存的摘要／引用定位，并调整本产品留存策略；不要把受限数据上传公共仓库。
