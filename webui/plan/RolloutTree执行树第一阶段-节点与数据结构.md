# Plan

定义 RolloutTree 的底层数据结构。**普通节点代表某个 Agent 的一次执行，rollout 代表路径；两者不能共用同一种节点语义。**

状态：代码已接入，核心结构检查通过；真实运行待服务器验收。依据 [实施总览](RolloutTree执行树实施总览.md)，不修改训练行为。

## Requirements

- 一个题目采样组一棵树，共用问题根节点；所有初始路径和真实分支都在树中。
- 同一个 Agent 多次运行产生不同节点；节点 ID 不能直接使用 Agent 名称或 rollout ID。
- 过程节点可读取真实内容；结束节点保留该路径的答案、状态和最终奖励。
- 分支引用准确的来源节点、attempt 和恢复快照，不用答案相同判断共享前缀。

## Proposed Architecture

### 三种可见节点

| 类型 | 作用 | 示例 |
| --- | --- | --- |
| `query` | 问题根，不执行 | 这道题的题目 |
| `execution` | Agent/Tool 的一次执行 | hub 第1轮、Python 第1次调用、hub 第2轮 |
| `outcome` | 某条路径结束 | 答案 A、最终奖励，或执行失败 |

Window/Snapshot 是执行完成后的分支位置与恢复引用，不再默认新增独立技术节点。需要标示分叉时，可在节点出口画小标记；它不是一次 Agent 执行。

节点的粒度是 MAS 层的一次执行轮次。在当前实现中，hub 每次 `call_model()` 返回一个结果就是一轮，工具每次调用就是一轮；控制提示和 HTTP 重试放进相应节点详情。工具内部尚未记录的实现，不猜测拆成多个 Agent 节点。

### 树的最小结构

以下为结构示意，完整字段类型在实施时用现有 Pydantic 风格定义：

```text
RolloutTree
  schema_version: 3
  tree_id, experiment_id, run_id, mode, group_id, query
  nodes: Node[]
  edges: Edge[]
  rollouts: RolloutRecord[]
  outcomes: { result_node_id: 已有结果字段 }
  revision

Node
  node_id, kind
  rollout_id, attempt_id          # query 不需要
  agent_id, agent_kind, turn      # execution 使用
  status, summary, detail_ref
  sampling                       # 可选：已有门控评估结果

Edge
  source_node_id, target_node_id
  kind: sequence | branch
  window_id, snapshot_ref         # branch 使用

RolloutRecord
  rollout_id, attempt_id
  origin: initial | independent_fill | branch
  source_rollout_id, source_attempt_id
  fork_node_ids, window_id, snapshot_ref
  first_node_id, result_node_id, status
```

`Node` 不保存另一份 parent，连接统一由 `edges` 表达，避免两处关系不一致。多个并行工具可连接到同一个后续节点；`fork_node_ids` 平时只有一个元素，整批工具共同完成后恢复时才记录多个。UI 将其出口作局部汇合，不需要另建通用图系统。

节点只保存摘要和 `detail_ref`；实际消息与长内容放 Archive。`outcomes` 复用已有答案/reward 字段，不创建第二套奖励数据。

### 一个具体例子

```text
节点：Q，A1(hub)，A2(Python)，A3(hub)，B1(hub)，R1，R2
普通连线：Q→A1，A1→A2，A2→A3，A3→R1，B1→R2
分支连线：A2→B1，附带真实 snapshot_ref

初始路径：Q→A1→A2→A3→R1
分支路径：Q→A1→A2→B1→R2
```

两条路径共享 A1/A2，但没有复制节点。R1 仍保留，不会因为出现 R2 而变成“没有最终答案的内部节点”。

### 节点详情

保留实际输入、模型返回的 reasoning 与普通输出、工具参数/结果、错误和已有耗时/token/熵信息。只有实际返回的 reasoning 才显示为独立推理内容；未返回时显示普通输出，不生成补充解释。

输入应是经过上下文处理后真正用于本次调用的消息。被裁剪、脱敏或未保存的内容有明确提示，不把摘要称为全文。

## Compatibility

新 run 使用 v3 执行节点结构；旧 v2 继续按回答来源结构读取。不把旧 `parent_id` 就地解释成执行顺序，也不要求新 run 同时生成 v2/v3 两份树。

沿用已有 attempt 身份，防止重试混线；child 的来源必须锁定产生快照的 attempt。Agent 定义取本次运行配置，不从当前编辑草稿补历史信息。

## Files and Entry Points

| 文件或区域 | 职责 |
| --- | --- |
| `mas\workflow\contracts.py` | 扩展现有树结构并明确版本，不预先增加多个结构模块 |
| `mas\workflow\rollout_results.py` | 复用结果字段及 rollout/attempt 关联 |
| `mas\tests` | 两条初始路径、共享前缀、并行工具和旧版本的结构样例 |

## Action Items

- [x] 定义 v3 节点、连线和路径归属。
- [x] 明确节点详情引用与结果映射。
- [x] 固定旧版本读取方式，避免混用两种节点语义。

## Implementation Notes

- 2026-09-28：扩展现有 `RolloutTree`，v3 的 `nodes` 为 query/execution/outcome，`rollouts` 保存原有调度与结果关联，`edges` 表示真实执行和分支关系。保留旧字段用于 v1/v2 读取，不改变旧 `parent_id` 的含义。
- 树验证覆盖执行归属、重复节点/连线和环；结果按 rollout/attempt 生成独立结束节点，重试前的结果仍可作为历史来源保留。

## Acceptance and Delivery Boundary

数据样例能表示“两个 initial rollout，其中一个在指定节点后产生 child”，且共享节点只有一份。不同 Agent 执行、不同 attempt、不同采样组互不混淆。

结构正确不等于已记录真实过程，下一阶段接入运行代码。

## Next Phase

[第二阶段：执行过程记录](RolloutTree执行树第二阶段-执行过程记录.md)。
