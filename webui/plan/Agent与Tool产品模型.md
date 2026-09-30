# Agent 与 Tool 产品模型

UI 保持用户熟悉的 Agent、Tool、Router 三类对象。**Agent 类型只有三种**：Planner、Verifier、自定义 Agent。五个内置 Tool 全部是封装 agent（内核 + LLM），不是 MAS 图上的纯函数。

| 类型 | 示例 | 形态 |
| --- | --- | --- |
| Planner | 任务分解 | 多轮窗口，输出 `plan_step`，不直接调工具 |
| Verifier | 子目标判定 | 单次窗口，失败沿 feedback 回 planner |
| 自定义 Agent | 用户 JSON Schema | 单次 LLM 窗口，可进 Router 的 agent set |
| 封装工具 | wikipedia / google / web / python_coder / think | `agents[].kind: tool`，HIVE 式 LLM-in-tool |
| Router | 下游 agent set | 拆解上游 `plan_step`，fan-out 一条或多条 `tool_invoke` |

保存时 Agent 栏不出现 hub / tool-agent 术语；Tool 栏五个 id 一律写成 `kind: tool`。
