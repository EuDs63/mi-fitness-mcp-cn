# Changelog

## Unreleased（MCP 数据接入与准确性）

- Web 页面重做为暖白、灰绿的极简拟物风格；日期与记录优先展示，原始 JSON 和账号密钥收进工具区
- 概览增加真实活动趋势与睡眠分期时长；心率、血氧、压力、运动、体成分、事件及同步结果增加可读展示，明细支持分页，睡眠支持选择历史记录
- 查询日期或切换页面自动加载；明细请求避免旧响应覆盖新范围，图表区分缺失日期与已记录的零，取消固定的健康评价
- 步数与活动热量采用云端已合并的每日汇总，修正多来源重复累加；分钟明细去重后用于距离等字段
- 修正深睡、浅睡、REM、清醒的状态映射，避免重复扣除清醒时间；睡眠按本地起床日期归属，覆盖统计也保留本地日期
- MCP 复用单账号的现有 Web 登录；多账号需要显式选择，凭据继续从系统 keyring 读取
- 新增离线 `get_analysis_snapshot`，提供单位、日统计、记录覆盖范围及数据质量说明；MCP 返回结构化结果并正确标记错误
- MCP SDK 最低版本更新到已验证的 1.30，支持工具注解和结构化返回
- 修正前端响应解析、最新样本选择、日期快捷范围、刷新竞态及窄窗口遮挡；刷新页面保留查询日期
- CI 增加前端回归测试，维护约定和接入文档转向本 fork

## 0.2.2（零第三方请求）

- 移除 Web 仪表盘与测试页的 Google Fonts 外链：打开页面不再向 Google 发送任何请求（此前浏览器会上传 IP/UA），改用系统字体栈，国内加载也更快、离线可渲染
- 发往小米的请求覆盖默认 `python-httpx/*` User-Agent 为浏览器 UA，去除脚本指纹（与 Cookie 登录来源一致）
- `docs/PRIVACY.md` 补充浏览器端零外链与最小化出站请求头说明

## 0.2.1（隐私加固）

- 数据安全审计文档 `docs/PRIVACY.md`：全部对外请求清单（仅小米域名）、本机数据存放表、威胁模型与自验方法
- CORS 收紧：默认仅允许本机来源（原来为 `*`，恶意网页可跨站读取本地健康数据）；可用 `MI_FITNESS_CORS_ORIGINS` 覆盖
- Host 头白名单中间件（FastAPI + Flask 双侧）：阻断 DNS 重绑定攻击；非回环绑定时 CLI 自动放行绑定地址，可用 `MI_FITNESS_ALLOWED_HOSTS` 覆盖
- API Key 的 passToken 迁出 SQLite 明文，改存系统 keyring（启动时自动迁移历史数据）；吊销时同步清理
- `api` 命令默认关闭 uvicorn 访问日志（查询参数不再落入终端）
- 新增 `GET /api/export`：本地数据导出为 JSON/CSV（含 Excel BOM），纯离线操作

## 0.2.0

- 内置 Web 仪表盘（`mi-fitness-mcp web`，Flask）：可视化测试全部 API 端点、Key 管理、扫码登录，内置反向代理（自动附加 X-API-Key/X-Admin-Key，上游耗时透传）
- REST API 服务（`mi-fitness-mcp api`，FastAPI）：全部数据端点 + 同步（前台/后台）+ 覆盖统计，交互式文档 `/docs`
- API Key 体系：`POST /api/auth/keys` 用小米凭据换取 `mif_sk_*` Key（类大模型平台风格），支持多账号上下文、last_used 统计、按前缀吊销；静态 Key 经 `MI_FITNESS_API_KEY`、管理端点经 `MI_FITNESS_ADMIN_KEY`
- 扫码登录：逆向小米通用扫码流程（`sid=xiaomiio`），`/api/auth/qr/start|poll` 生成二维码并轮询换取凭据后自动发放 Key，无需浏览器 F12
- Rust 测试页 `testpage/`（可选，内置 Web 仪表盘的 Rust 替代实现）
- 修复：`mcp` 依赖加上界 `<2`（MCP SDK 2.x 移除 `Server.list_tools` 导致启动崩溃）
- 文档：隐私与数据安全审计 `docs/PRIVACY.md`

## 0.1.0

- initial standalone `mi-fitness-mcp` repository
- Xiaomi auth via `userId + passToken`
- Mi Fitness cloud sync for steps, heart rate, calories, body measurements
- MCP tools for sync, summaries, heart rate, body measurements, coverage
