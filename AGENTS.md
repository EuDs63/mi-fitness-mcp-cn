# 维护约定

- 本 fork 的推送目标是 `https://github.com/EuDs63/mi-fitness-mcp-cn`（`origin`）。原作者仓库保留为 `upstream`，用于参考和同步。
- 优先保证 MCP 的数据准确性、账号选择、离线查询和分析所需字段。前端主要承担登录、同步和排错，保持必要修复即可。
- 前端遵循用户偏好的极简拟物风格：暖白底色、克制的灰绿、细线与轻微压痕，避免霓虹、玻璃光晕、彩色装饰和无依据的健康评价。数据展示应有单位、日期、缺失状态与可读明细。
- 不提交本地健康数据库、导出数据、真实账号信息、凭据、API Key、云端原始响应、截图和运行日志。测试使用虚构账号和合成样例。
- 修改解析或汇总时，保留单位、时区、缺失值和来源重叠的语义；不要把缺失记录填成健康指标为零。
- `src/mi_fitness_mcp/web_assets` 与 `testpage` 中对应的前端文件需要同步。
- 提交前执行 `ruff check src tests`、`pytest`、`node --test tests/test_dashboard.cjs` 和 `python -m build`。
