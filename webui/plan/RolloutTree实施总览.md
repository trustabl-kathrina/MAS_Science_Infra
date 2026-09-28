# Plan

以 [new_framework 设计](../../docs/New_framework_design.md) §1.4–1.6、§2.4–2.7 为主要依据，完成 RolloutTree 的最小闭环：实际采样产生树，结果与判定回填，按运行保存，页面持续读取并解释分支来源。

三个阶段代码均已接入，核心快速检查与前端生产编译通过，真实服务器训练及浏览器视觉验收待完成；详细进展见各阶段 Implementation Notes。只补 RolloutTree，不重写 Sampling、Store、VERL、优化器或整个日志系统。

## Position in the Project

RolloutTree 保持一等结构，不用普通日志表或通用图系统替代。它承载 query、分支来源、窗口指标、结果和已有判定，供 UI 与 Harness 使用。训练继续消费既有 Store、快照和训练批次，不能在浏览器或展示文件中另算奖励。

实施顺序：

1. [第一阶段：树结构与运行归档](RolloutTree第一阶段-树结构与运行归档.md)。
2. [第二阶段：结果回填与按运行读取](RolloutTree第二阶段-结果回填与按运行读取.md)。
3. [第三阶段：树视图与持续更新](RolloutTree第三阶段-树视图与持续更新.md)。

前置条件是已有 Sampling 路径能够提供实际 parent、Window、Site 和 snapshot 来源；不得为满足树展示而制造分支。服务器是否真正发生分支仍需独立验收，不以页面有树代替。

## Requirements

- 保留 `RolloutTree`、`RolloutTreeNode`、`RolloutTreeEvent`，增量扩展已有类型。
- 一棵树对应一次运行内的一次题目采样组，不跨 run、不跨组拼树。
- query 是分组根；其下包含所有实际初始 rollout、独立补采样与真实分支。
- 区分计划、实际执行、结果记录和训练判定；未知值保留缺失。
- 普通进程日志、单条执行轨迹与 RolloutTree 相互关联，但不混为一种节点。
- 树写入或读取故障明确可见，不能修改训练 reward 或伪装为 rollout 失败。
- 全程保持旧 expansion 读法和既有训练行为，不先改六种算法。

## Scope

- In：树语义、身份、来源映射、运行归档、状态与结果回填、已有 verdict/credit 来源、只读 API、树页和有界持续更新。
- In：为已有 Harness 提供同一版本树及明确的结果字段，不建立第二套数据源。
- Out：完整 token/窗口执行前缀树、消息内容去重图、分布式事件平台、树驱动训练恢复。
- Out：新节点 credit 算法、k-hop 训练接线、自动因果推断、完整双态实时 Harness 产品。
- Out：把所有历史 Collect 记录迁移成训练树，或把当前调试 run ID 当训练 run ID 使用。

## Current State

基线来自当前代码，而非旧文档中的完成声明：

| 位置 | 已有能力与缺口 |
| --- | --- |
| `mas\workflow\contracts.py` | 已有平铺 `nodes + parent_id`、`outcomes`、查叶子和祖先的方法；缺运行归属、执行状态和版本，未完整验证树关系 |
| `mas\workflow\active_set.py` | `tree_from_plans()` 用父 rollout 作 root，统一挂接计划；调用未传 task，不能代表完整 query 树 |
| `mas\lit_tir_agent.py` | 已知预测答案、reward、Archive 与窗口信息；输出日志和 annotation，不等于树结果已回填 |
| `rl\hooks\daemon.py` | 入队后局部写树，按列表顺序替换计划节点 ID；批量多 parent 和跳过计划时存在错配风险 |
| `rl\hooks\rae_advantage.py` | 有 verdict 与 k-hop 辅助函数；`apply_verdicts_to_tree()` 未接通训练中的持久回填 |
| `science_infra\control\app.py` | 旧树接口扫描共享目录；实验参数不隔离文件，事件转发依赖全局 EventBus 唤醒 |
| `webui\src` | 已有训练记录、控制台、单题轨迹；没有新 RolloutTree 页面 |

## Proposed Architecture

### 文档中的矛盾与本轮裁决

| 设计中的表述 | 矛盾或风险 | 最小实施选择 |
| --- | --- | --- |
| root→leaf 是完整执行路径；节点 ID 又用 rollout ID | 完整 rollout 不是一个前缀状态，沿祖先拼接完整消息会重复或包含未走过的后缀 | 采用当前代码可真实支持的 rollout 派生粒度；边指明恢复窗口，不把祖先路径称为逐步执行轨迹 |
| 叶子有 outcome | 父 rollout 已完成后仍可从中途快照产生 child；父变为内部节点但结果仍有效 | `outcomes` 按实际 rollout ID 保存所有已记录结果，包括内部节点；叶子只是没有后代的候选，不是唯一结果载体 |
| 节点状态、节点 credit 与窗口语义相关 | 一个 rollout 可能经过多个窗口，不能把整条奖励冒充任意窗口贡献 | 分支窗口记录在 child 的来源字段；节点 `reward` 仅保存有明确来源的已有 credit，否则为空 |
| 同 branch 上 k-hop 累积 | 派生祖先不是执行中的连续 k 个窗口；已有辅助函数还是均值，与文档“等权和”不同 | 本轮不启用或修改 k-hop 算法，不用它填展示值；未来算法实施须单独确定节点粒度与公式 |
| `tree_id = data_id + group` | 原始题目可重复；当前上游 `data_id` 是每次采样生成的标识，不一定是数据集行 ID | 以 experiment/run/mode/采样组生成树 ID；原始 task ID 只用于展示和查找 |
| 通过 `.local_expansion` 给页面读树 | expansion 是训练恢复输入，共享目录又没有可信 run 归属 | 保留旧产物供训练使用，另在现有 run 目录保存树；不复制消息快照 |
| loss 作为树事件 | batch loss 可能覆盖多棵树，当前 `tree_id="global"` 也不是具体题目 | loss 保留 run/batch 作用域；没有明确归属不写到某个节点 |
| Collect 是单链树 | 统一形状不能证明发生了训练分支 | 保留这个可表示性，但本轮交付训练树；无分支明确显示独立采样，不伪造 Collect 迁移 |

这里对“只有叶子保存结果”作明确修订，保留原设计的 query、分支、指标、两级奖励和树视图，不为满足外形增加重复的 outcome 节点。这不是完整执行前缀树的实现声明。

### 三种记录的边界

```text
stdout.log                    进程、依赖、GPU、异常
Trajectory / Archive          某次实际执行的消息、Agent 窗口和恢复内容
RolloutTree                   同组 rollout 的来源、状态、结果与判定
```

```text
Query（分组根，不参与执行）
├─ A  初始 rollout       outcome: 0.4
│  ├─ A1  从 A 的 W2 续跑  outcome: 0.8
│  └─ A2  从 A 的 W2 续跑  outcome: 尚未记录
└─ B  独立 rollout       outcome: 0.6
```

query→A/B 是分组边；A→A1/A2 是续跑边，不表示完整执行完 A 后再执行 child。A 的 outcome 在产生 child 后仍保留。窗口相同、同题同组的候选可以比较；不能仅凭同层或答案相似推断共享前缀。

### 一条写入链，不新增通用基础设施

```text
Store 入队/状态 + Runner 结构化结果 + 已有训练判定
    → 我方 Daemon 的树聚合器（唯一树写入者）
    → 按 run 的树快照与轻量摘要
    → Control 归属校验后的只读 API
    → RolloutTree 页面 / 已有 Harness
```

Worker 不争写树文件，Control 不与 Daemon 合并写同一棵树。先用有界快照轮询完成页面持续更新；沿用树事件表达变化、服务内部消费，不为此新建可靠消息队列或事件回放库。轮询能恢复页面最新状态，不宣称保留所有瞬时中间状态。

## API and Data Boundary

- 新字段、状态与来源以第一阶段为准；结果、诊断和读取以第二阶段为准。
- 旧格式可读，但缺少运行归属不能推测补齐，也不能混进新 run 页面。
- Store 的执行状态、树的记录完整性与 Control 的 run 状态分别返回。
- UI 只读经过筛选的摘要与详情；API Key、完整 prompt、原始 Archive 不进入公共索引。
- 没有确认可用的 Agent Trace 时显示“未记录执行详情”，不能拿独立调试轨迹补位。

## Action Items

- [x] 第一阶段建立正确分组、树关系和真实入队映射（代码完成，服务器待验收）。
- [x] 第二阶段回填结果和已有判定，交付按 run 读取（代码完成，服务器待验收）。
- [x] 第三阶段交付采样结果页、回答列表/分支关系、缺失态与持续更新（代码完成，服务器与视觉验收待完成）。
- [ ] 按三个阶段的验收边界记录实际完成情况，不用类型定义代替闭环。

## Acceptance and Delivery Boundary

同一次训练中，独立候选与真实 child 都能归入正确题目采样组；child 能追溯到 parent/窗口/快照；父子各自的结果不丢失；刷新、离开后返回和 Control 重启后仍可读取同一运行产物。页面能解释“从哪里分支、实际执行状态、得到什么结果”，不能无依据回答“哪个窗口产生了多少梯度贡献”。

闭环完成指 RolloutTree 的记录、回填、持久读取和展示完成，不表示 new_framework 的全部节点优化或实时 Harness 已完成。

## Risks and Edge Cases

- 当前 v1 Store 是首个落地点；v0 不重写上游，旧训练入口保持可用，未支持树时明确声明。
- 同题跨批次/训练验证重复、重试 attempt、失败 child、未入队计划都必须分清。
- 可视化失败不改训练结果，但不能静默吞掉丢失记录。
- 文档验收是后续实施要求；本次文档修订不执行训练，不新增测试代码。

## Next Phase

[第一阶段：树结构与运行归档](RolloutTree第一阶段-树结构与运行归档.md)。
