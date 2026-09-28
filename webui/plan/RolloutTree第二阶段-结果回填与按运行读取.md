# Plan

本阶段让第一阶段的树成为有真实结果的运行记录：持续回填执行状态、答案、rollout reward 和已有 verdict/credit，交付按运行校验的只读列表和详情。

依据 [new_framework 设计](../../docs/New_framework_design.md) §2.4–2.6；语义裁决见 [实施总览](RolloutTree实施总览.md)，依赖 [第一阶段](RolloutTree第一阶段-树结构与运行归档.md)。

## Position in the Project

这是三个阶段的第二阶段。只记录实际结果与训练已经计算的信号，不改变优化策略，不因树字段为空新增一次模型调用或奖励计算。

## Requirements

- 有 child 的父 rollout 仍保留自身答案和最终 reward。
- 状态、答案、reward、verdict 可分批到达；缺失值不得补零、负分、成功或 abstain。
- 每条结果关联实际 rollout 和 attempt；过期 attempt 不覆盖新 attempt。
- Store 执行状态、训练样本是否被接纳、记录完整性分别表达。
- 已有判定按实际 ID 回填；不按节点顺序、同层位置或相似答案关联。
- 列表与详情校验 experiment/run 归属；只返回脱敏且有界的结果。

## Scope

- In：Runner 结果来源、Store 状态对账、结果与已有判定回填、失败/中断记录、只读 API、已有 Harness 的最小适配。
- Out：新 reward、k-hop 优化、从树恢复训练、可靠事件总线、全量 Trace 重建。
- Out：让 reward 差异直接成为 reward hacking 或某个 Agent 贡献的确定结论。

## Current State

- `TirAgentLit.rollout()` 已持有 `prediction/reward/raw.error` 等信息，但日志行不能作为正式答案解析来源。
- `_validate_data_v1()` 读取最新 attempt spans，取得 `final_reward`，尚未持续更新树。
- 上游 `_async_run_until_finished()` 消费已完成 rollout；只有完成回调不能覆盖所有运行中、超时与失联情况。
- Daemon 已向训练批次写 `verdict_list`；同一 rollout 可能展开成多行训练数据，不能直接将行号当节点。
- `apply_verdicts_to_tree()` 支持 ID 写回；其可选位置重映射不能用于新版路径。
- `RewardHackingMonitor` 当前读取节点 `reward`、按 parent 分组，不能直接拿它比较新版 outcome reward 或不同窗口的所有 child。

## Proposed Architecture

### 明确来源，不解析自然语言日志

| 字段 | 来源与处理 |
| --- | --- |
| 执行状态、attempt、时间 | Store 可用状态；不支持的状态不猜测 |
| 最终答案、格式、执行错误、轨迹引用 | Runner 在现有 annotation/span 通道补一个有版本的结构化结果摘要，带 rollout/attempt |
| rollout reward | Daemon 已从真实 reward span/适配结果取得的值；保留来源，禁止训练缺失值回退污染展示 |
| verdict | 现有训练批次最终采用的值，按 rollout/action/window 对应关系归档 |
| 节点 credit | 只有现有算法确实输出可归属数值时填 `node.reward`；否则保持空 |
| loss | 已有 run/batch 指标；没有题目级关联就不进入单树节点 |

先确认当前 span 后端可保存所需摘要；仅传有界答案摘要、错误分类和已有可访问引用，不传原始 prompt 或 API Key。完整答案若已有受控产物则返回详情引用；没有时明确截断，不能声称支持未实现的完整下载。

### 回填时机

1. 完成回调内，在转换丢失 Store 身份前保留 rollout/attempt/status；处理对应 attempt 的 spans，写回已知事实。
2. 在我方 Daemon 的等待阶段增加有界状态对账，查询本批已知 IDs；使用同一 Store，不让浏览器或 Control 直接访问训练 Store。
3. 不复制上游整段等待算法：优先在我方等待方法外围组合一个可取消的对账协程，`finally` 中停止并完成最后一次可用对账。
4. verdict 批次形成后、批次映射清空前，按真实 ID 回填，并将发生变化的树持久化。
5. 写入成功后发布带 revision 的 `RolloutTreeEvent`；事件通知失败不撤销已保存结果。

控制更新频率，只在事实变化时递增树 revision；同一轮对账合并写一次，不按 token、span 或 UI 请求刷文件。

### 状态与 attempt

| 场景 | 处理 |
| --- | --- |
| Store 只有已入队证据 | `enqueued`；不能根据时间猜 running |
| 实际观察到执行中 | 更新 `running` 和来源 |
| 执行完成但没有答案或 reward | 保留真实终态，结果字段为空，显示记录不完整 |
| 有显式执行异常/超时 | 记录失败与原因；区分 Store 调度完成和 Agent 执行错误 |
| 训练适配拒绝样本 | 单独记训练接纳结果；不把本来完成的模型执行改成失败 |
| 重试 attempt | 节点身份不变，当前结果关联新 attempt；迟到旧结果不覆盖，旧 Trace 保持原引用 |
| 同一结果重复到达 | 同值不写；同来源同版本冲突保留问题记录，不取“最后收到”冒充正确 |
| run 中断但没有 rollout 终态 | 保留最后已知状态，结合 run 状态显示“运行已结束，结果未确认” |

没有 Store 恢复能力时，不承诺进程被强杀后能补回所有结果。Control 重启只需读持久树；Daemon 重启从快照与可用 Store 对账，不重新提交训练任务。

### 两级奖励和 Harness 的最小接线

- `outcomes[rollout_id]` 保存答案、最终 reward、attempt 与来源；不限定 key 必须是 `leaves()` 的结果。
- `node.reward` 继续专指节点 credit；不能复制 outcome reward 来让节点“看起来有分”。
- `node.verdict` 仅在同一节点有唯一、可归属的判定时填。多窗口/多 action 有不同 verdict 时，在结构化判定明细中保留各自来源，节点摘要为空并提示多个判定，不任意取第一行。
- 不将真实的 `none`/未计算归一化成 `abstain`；`abstain` 是算法已作出的判定。
- 现有 Harness 在同一树更新后读取同一 revision 的快照，或在按需诊断时复用同一读取函数；不在前端重新计算。
- 适配已有 reward monitor 时明确选择 outcome reward 或 credit，同一次比较不混用；限定同组、同 parent、同 Window/snapshot 和同判定策略的可比候选，只输出“异常线索”。
- 本阶段可完成树→已有诊断函数→带身份的诊断结果这条路径；不新建完整实时诊断服务。无启用的诊断器时页面不显示已诊断。

## API and Data Boundary

拟新增一个薄路由模块，复用 `training_logs.training_run()` 和 `PROCS.run_dir()`：

```text
GET /api/rl/runs/<run_id>/rollout-trees?experiment_id=<id>&offset=0&limit=20
GET /api/rl/runs/<run_id>/rollout-trees/<tree_id>?experiment_id=<id>
```

| 响应 | 内容 |
| --- | --- |
| 列表 | schema/version、记录可用性、run 状态、摘要 revision、分页、当前页题目摘要、节点/分支/完成数量、可用奖励范围 |
| 单树 | 运行与组身份、tree revision、节点/计划/结果/来源、记录缺口、诊断可用性 |
| 较大树 | 支持按 parent/游标取节点页；返回包含必要祖先的首屏、是否截断和 `next_cursor`，不声称这是整棵树 |

列表按稳定组创建顺序排序，轮询更新状态不随 reward 排名跳动。状态/任务筛选若提供，必须在服务端摘要范围处理；前端不能把当前页过滤当作全量搜索。详情支持 revision/ETag 未变化时不返回重复正文。

先通过 run 归属校验，再验证受控 tree ID、解析路径和文件内部身份；旧运行缺记录、空组、记录损坏与无权访问分别处理。禁止由客户端传入目录，禁止读取共享 `.local_expansion` 补位。

分页不要求新数据库。树文件是该组完整快照，Control 在请求时受控读取并裁剪节点页；这是传输与渲染限量，不冒称磁盘随机索引。遇到超过服务端读取上限的单树须明确报规模限制，不静默丢节点。

## Files and Entry Points

| 文件或区域 | 调整职责 |
| --- | --- |
| `mas\lit_tir_agent.py` | 发出有界结构化结果及可确认的来源引用 |
| `rl\hooks\daemon.py` | attempt 对应、完成回填、等待期间状态对账、判定回填、停止对账任务 |
| `mas\workflow\rollout_tree.py` | 幂等更新、来源冲突、结果完整性、快照与摘要 |
| `rl\hooks\rae_advantage.py` | 复用 ID 写回，不新增 credit 算法或位置映射 |
| `mas\workflow\harness.py` | 区分两级奖励、过滤可比集合，复用树读取结果 |
| `science_infra\control\rollout_trees.py`（拟新增）、`app.py` | 按 run 校验、分页/有界详情、版本与缺失态 |

## Action Items

- [x] 补齐 Runner 的结构化结果来源，禁止从日志正则提取答案。
- [x] 接通完成回填与有界 Store 状态对账，覆盖重试、失败和中断。
- [x] 按实际 ID 写回已有 verdict，保留缺失与冲突；当前没有新增数值 credit 生产者，不补算 credit。
- [x] 为现有 Harness 提供相同版本的树和明确奖励字段。
- [x] 交付归属校验、分页摘要、有界详情及版本响应。
- [x] 核心检查确认批次归档、终态和故障时持久产物可读取；真实服务器训练待验收。

## Implementation Notes

- 训练回归修复：图构建、执行和结果处理异常新增 `error_details`，包含阶段、异常类型和最长 1000 字符的脱敏摘要，同时记录 rollout/attempt。复用现有密钥和 URL 脱敏逻辑，不输出原始请求上下文。Runner annotation、树 outcome 和回答详情贯通此字段，历史仅有 `execution_error` 的记录仍可读取，但无法追补当时丢失的错误原因。
- 全批无有效 prompt/response token 时，我方 Daemon 在进入上游张量构造前明确中止并输出样本计数、过滤规则和示例 rollout ID；不伪造 token、不补造训练样本、不修改 reward，也不静默跳过整批。节点名与 Adapter 过滤已共用合法命名函数，这是根因修复，空批次检查只是辅助诊断。
- 二波入队日志分别显示实际提交的 branch 数与 independent fill 数，不再把所有补采样统称 branch/resume。真实训练仍需服务器验证；本地检查不证明已完成参数更新。
- 2026-09-28：第二阶段代码已接入；本地仅检查核心纯逻辑、假 Store 和进程内 HTTP，不启动 GPU、浏览器或训练服务。第三阶段 UI 尚未实施。
- 新增 `mas\workflow\rollout_results.py` 负责有版本的 Runner 摘要、attempt 顺序、结果合并和判定明细；归档仍由第一阶段模块负责。`rl\hooks\rollout_tree.py` 负责 Store 对账与训练边界容错，不把全部逻辑堆入 Daemon。
- Runner 通过现有 annotation 的 `tir.rollout_result` 字符串字段发送 JSON，避免嵌套属性被展开后丢失结构。只记录最长 4000 字符答案、截断标记、格式标记、已实际发出的 reward、错误分类及已有 Archive ID，不复制提示词和完整错误内容。Archive ID 只是来源，不声明新增了完整 Trace 下载接口。
- 完成路径按明确 attempt ID 读取 spans；普通 GRPO 保持原来的适配、奖励提取与元数据含义。适配失败继续抛出原错误，但先保留结构化结果及 `training_status=rejected`。
- `store_status` 保留调度事实；`status` 表达可观测执行结果；`training_status` 表达 adapted/empty/accepted/rejected。Store succeeded 而 Runner 报执行错误时，不把其显示为成功。超时/失联 attempt 保留原状态原因，run 中断不推测所有节点失败。
- 新 attempt 以 Store `sequence_id` 决定顺序，旧 attempt 的结果及来源保存在 `previous_attempts`。同序号身份冲突、同字段结果冲突保留已有值并记录问题；不同 attempt 的答案、奖励与判定不混合。奖励 0 保留为实际值。
- 训练批次通过 `rollout_id_list` 回填实际采用的 verdict/action/window/scheme/step。一个 rollout 的多行判定保留明细；只有唯一有效 verdict 才显示节点摘要。`none` 不改写为 abstain，`node.reward` 不复制最终奖励。当前没有可靠节点数值 credit 生产者，保持为空。
- 等待期间组合一个可取消的对账任务，每轮最多 100 个本批已知 ID，轮转处理，查询与总对账都有超时。每次暂停后约 3 秒继续；结束时取消任务并再做一次有界对账，强杀不能保证补回没有保存的结果。
- 终态的补读限制为该 attempt 最近 64 条 annotation；未找到摘要且达到上限时记录缺口。正常完成路径读取实际适配所用 spans，不受这一补读窗口限制。批次很大或 Store 故障时，最终有界对账不承诺遍历所有 ID，未确认状态保持未知。
- 同一轮观察合并后统一保存，字段无变化不递增 revision；manifest 无变化不重复写盘。持久化成功后发 `tree_updated`，携带 experiment/run/tree/revision；通知失败不撤销快照，页面读取不依赖 SSE。
- 新增 `science_infra\control\rollout_trees.py` 并注册两个只读路由。沿用 `training_run()` 的运行归属校验；限制文件读取大小、树 ID 与解析后路径，校验文件内部身份。接口不访问训练 Store，不回退共享目录。
- 列表默认 20 项、上限 100；可按 mode/task_id 过滤，按创建时间稳定排序，仅读取当前页题目摘要。单树默认 100 个 rollout、上限 500，补必要祖先，节点 cursor 含树 revision；版本变化返回 409 要求重读。计划独立 offset 分页，结果只返回可见节点对应内容，ETag 支持 304。
- 树读取上限 16 MiB、manifest 上限 4 MiB，超过限制明确返回 413，不静默截成完整树。节点页返回缺失字段、运行终止但节点终态未确认等标记；已归档的旧树无需训练进程存活即可读取。
- 详情传 `diagnose=true` 时才运行现有 RewardHackingMonitor，输出与本次读取树 revision 一致的异常线索。v2 仅比较同 parent/window/snapshot/策略且无记录冲突的终态候选，`reward_level=outcome|credit` 不混用。未请求时返回 not_requested，不声明后台已运行实时 Harness。
- 核心检查覆盖旧格式、父子 outcome、奖励 0、迟到/重复 attempt、冲突、多判定、实际 Daemon 完成方法、对账取消、分页/ETag/归属、损坏与缺失产物及 Harness 可比范围。原 `test_realtime_harness.py` 两个直接导入完整 Daemon 的用例需要本地缺失的 Agent-Lightning，不在此安装完整训练栈；已运行其中不依赖该栈的 Diagnoser 用例。
- 服务器验收重点：真实 annotation 可读取、同一个 rollout/attempt 的答案与训练实际奖励一致、失败/重试不覆盖、批次清理前判定落盘、停止/重启后 API 仍可查询。两级奖励算法、Trace 下载和树 UI 不在本阶段完成范围内。

## Acceptance and Delivery Boundary

- A 已完成后产生 A1，A 和 A1 的答案与奖励都保留；奖励 0 与未记录可区分。
- 不产生分支的组也有实际结果；planned 不会计为失败或完成。
- 旧 attempt 迟到、重复完成和重复 verdict 不污染新结果。
- “执行失败”“未确认终态”“树记录失败”“未计算 credit”具有不同返回值。
- 另一个实验不能读到当前 run 的树；同题不同组不混合。
- 断开 UI 或重启 Control 后仍可只依赖持久产物读取；没有产物时明确报缺失。
- 用现有无 GPU 机制核对回填与读取；GPU 验收由用户启动。本阶段不宣称节点 credit 算法或树页面完成。

## Risks and Edge Cases

- reward span 与答案摘要可能分批到达，不能以 reward 已有作为答案完整的证明。
- 一个 rollout 多行训练样本可能有不同判定，不得折叠成看似唯一的 verdict。
- 写树失败不让训练失败，但告警、记录状态与重试必须可观察；停止时重试有界，不无限阻塞资源释放。

## Next Phase

[第三阶段：树视图与持续更新](RolloutTree第三阶段-树视图与持续更新.md)。
