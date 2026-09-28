# Plan

本阶段将已有局部计划树补成按运行归属的 RolloutTree：明确 query 根、实际 rollout、计划与分支来源，修复按位置回填 ID 的问题，并持久保存正确的树结构。

主要依据为 [new_framework 设计](../../docs/New_framework_design.md) §1.4、§2.4；矛盾裁决与总边界见 [实施总览](RolloutTree实施总览.md)。结果回填和页面分别在后两阶段实施。

## Position in the Project

这是三个阶段的第一阶段。树结构必须来自实际入队事实，不读取当前画布猜测，也不改变 Store 的执行策略。

首批支持当前 v1 Store 训练和同一 run 中的验证采样；不改变 v0 的训练行为，不承诺为缺少身份的旧产物补树。

## Requirements

- 每棵树只有一个 query 根；初始 rollout、独立补采样直接挂根，child 挂实际 parent rollout。
- 节点采用真实 Store rollout ID；query 与计划使用不同的受控身份空间。
- 同组多个初始 rollout 不拆成互不关联的树；同题不同采样组不合并。
- 多 parent、跳过计划、预算截断、重复处理均不能错配 child。
- 未入队计划不占实际 rollout 节点数，不进入完成率和奖励统计。
- 新增结构采用版本字段；旧解析和 `.local_expansion` 的训练读取保持兼容。

## Scope

- In：结构类型、树关系校验、分组、计划身份、入队映射、单写者、run 目录归档。
- Out：答案与 reward 回填、页面、新的 Sampling 决策、节点 credit 算法。
- Out：为树完整而执行额外 rollout，或修正训练采样预算。

## Current State

- `RolloutTree` 是平铺节点列表，通过 `parent_id` 连接；`leaves()` 与 `path_to_root()` 已有，但不是完整校验器。
- `tree_from_plans()` 将 parent rollout 当 root，并把多份计划挂到同一个 parent。
- `expansion_payload_from_result()` 没有把 task 传给树构造；无计划时还可能产生空根。
- Daemon 的增量和批量入队都用节点列表与结果列表位置配对；批量路径不能可靠保存全部 parent 的树。
- 上游 `_async_set_up()` 给每次样本采样生成 `data_id`，并维护 `_task_id_to_original_sample`；可复用这份实际映射，不需要按 query 文本聚合。
- `clear_data_and_server()` 会在下一批初始化时清理状态；已归档树不能随清理丢失。

## Proposed Architecture

### 最小字段

保留旧字段，新增字段优先使用可选值和明确版本，不扩大 `metrics` 为无约束杂物箱。

| 对象 | 拟新增或明确字段 |
| --- | --- |
| Tree | `schema_version=2`、`experiment_id`、`run_id`、`group_id`、可空 `task_id`、`mode`、`revision`、`updated_at`、记录完整性与问题摘要 |
| Node | `kind=query/rollout`、`origin=initial/independent_fill/branch`、可空 `attempt_id`、执行状态和时间 |
| child 来源 | `plan_id`、`site_id`、`window_id/event_id`、`boundary_snapshot_ref`、有来源的 Gate decision/metrics |
| Plan | 树内轻量 `plans[]`：`plan_id`、parent、窗口/快照/Site、计划状态、可空 `child_rollout_id`、未入队原因 |
| Event | 增加运行身份、结构版本、树 revision；作为变化通知，不作为唯一持久来源 |

`role` 继续表达旧 root/child/probe 算法角色，不能代替 `kind` 或执行状态。query 根没有执行状态、reward 和 attempt。`agent_path` 只在实际观测到时填，不用 Workflow 配置推演。

`outcomes` 与节点 `reward/verdict` 保留，本阶段不伪造内容。树深度采用 query=0、初始 rollout=1；Sampling 的 branch depth 仍采用自己的原值，在来源中保存，不能直接覆盖算法参数。

### 身份与计划映射

- v1 以本次采样生成的 `data_id` 作为 `group_id`；可用原始样本标识保存为 `task_id`，没有则留空。
- `tree_id` 由 experiment/run/mode/group 的规范化组合生成固定哈希；query 根 ID 从 tree ID 派生。文件名不使用题目、原始路径或任意用户文本。
- 每个将被提交的分支计划带稳定 `plan_id`。一个 expansion count 对应多个 child 时，为每个提交槽保存独立子计划身份，并沿旧 plan payload 传递。
- identity 在产生并写出计划时确定，重读同一计划不重新生成；优先复用已有稳定窗口身份，不按筛选后的列表序号重新编号。
- 构造请求时保留 `plan_id → request` 关系；响应后用 Store 保证的请求关联方式生成 `plan_id → rollout_id`。若只保证响应顺序，配对的是本次实际提交的请求及附带 plan_id，校验长度与来源，不与原始全量树节点配对。
- 对 child、独立补采样分别处理；增量与批量路径复用同一个入队结果归档函数。
- 树上的去重不等于 Store 入队的 exactly-once 保证。入队成功但映射落盘失败时，先查带 plan_id 的真实记录；无法确认则记归属缺失，不自动补交训练任务。

### 写入路径

```text
Control 创建 run
  → 传入受控 experiment/run/输出根
Daemon super()._async_set_up() 后
  → 使用实际 rollout→sample 映射创建 query 根及初始节点
Runner
  → 保留旧 plans/resume 内容，补稳定计划身份
Daemon 分支入队
  → 按每个计划写入对应真实 child
  → 校验、递增 revision、原子替换快照
```

拟保存位置：

```text
experiments/<id>/artifacts/runs/<run_id>/rollout-trees/
  manifest.json
  <tree_id>.json
```

`manifest.json` 只包含版本、写入状态及每棵树的轻量摘要，不包含完整 query/答案/消息。不引入数据库。先写树，再更新摘要；中途失败时旧快照保持可读，摘要允许滞后但不能覆盖新树。摘要可由受控目录中的合法树重建，仅在恢复/修复时做，不在每次请求扫描全量正文。

使用一个我方小型聚合/存储模块供 Daemon 复用；同进程串行合并，临时文件使用唯一名，原子替换。写入者启动从既有 revision 继续；Control 只读。当前单 Daemon 拓扑无需跨机器锁，若以后实际有多写者必须先改写入所有权，不能误认为原子替换能解决并发丢更新。

### 结构校验与旧格式

- 校验节点 ID 唯一、唯一 query 根、parent 存在、无环、同一 run/group、来源和 depth 一致。
- 乱序 child 暂存待关联；不要临时挂 query 根。仍无法关联时保留问题记录，不能显示成完整树。
- 未入队计划显示在计划区；被预算裁剪的计划标为未入队，不生成执行失败节点。
- 旧 Pydantic 解析继续接受旧 JSON；新字段写入前同步我方所有树读取者，不直接将新版树塞给旧的严格解析器。
- `.local_expansion` 继续保留旧 `{tree, plans}` 可读形态；新 run 树不再以旧 `tree` 字段为事实来源。
- 旧全局接口暂保留兼容；新版页面禁止回退扫描旧全局目录。

## API and Data Boundary

本阶段只冻结结构及持久产物，不暴露未完成的页面入口。来源引用不包含完整恢复消息；恢复仍走现有 Archive 和 plan。

写入失败须记录带 run/tree/操作的明确日志，并尽可能持久保存 degraded 状态；全盘不可写时以日志和缺失产物为故障证据，不能保证不存在的错误标记一定落盘。

## Files and Entry Points

| 文件或区域 | 调整职责 |
| --- | --- |
| `mas\workflow\contracts.py` | 版本、身份、计划、来源、状态及结构校验 |
| `mas\workflow\active_set.py`、`sampling` | 保留真实 parent、生成并传递稳定计划身份，不改变采样决策 |
| `mas\lit_tir_agent.py` | 将已有 task/采样来源传入 expansion 输出 |
| `rl\hooks\daemon.py` | 初始、增量、批量、独立补采样映射；清理前归档 |
| `mas\workflow\rollout_tree.py`（拟新增） | 小型树聚合与原子存储，不依赖 AGL/VERL |
| `science_infra\control\training.py` | 沿已有启动 snapshot/meta 传递 run 身份和受控目录 |

## Action Items

- [x] 增量定义版本、分组、计划身份及树关系校验。
- [x] 按实际初始入队记录建立 query 树，不遗漏无分支组。
- [x] 统一批量和增量入队的映射，移除树节点位置配对。
- [x] 建立 run 内单写者、原子快照和可修复摘要。
- [x] 保留旧 expansion 训练读取，明确旧格式与新版归档的边界。

## Implementation Notes

- 2026-09-28：第一阶段代码已接入，服务器真实训练尚待验收；第二阶段结果回填和第三阶段 UI 未在本轮实施。
- `contracts.py` 增量加入 v2 运行/组身份、query/rollout 类型、计划、来源、待关联节点与结构校验。旧 v1 仍可解析，旧 `leaves()` / `path_to_root()` 行为保留。
- `mas\workflow\rollout_tree.py` 独立处理树聚合和原子快照；`rl\hooks\rollout_tree.py` 在训练边界处理可诊断的记录故障。Daemon 只在初始入队、计划登记、实际提交和批次清理时调用，不新增运行控制器。
- Control 将输出目录及 experiment/run 身份传入训练进程；`bound_daemon_cls()` 捕获身份，避免依赖远端 Ray 进程继承临时环境变量。仅记录当前 Store v1；v0 保持训练行为并告警。
- 普通 GRPO 在启用树归档时使用带记录入口的 Daemon，仍调用上游数据适配和批次处理，未切换优化器；训练/验证、独立补采样均有分组记录。
- ForkPlan 创建时产生 `plan_id`，旧计划在筛选前按原始位置和来源生成稳定兼容 ID。Store 明确保证返回顺序，因此只配对本次真实提交请求与返回值，并核对 group/plan 身份；不再将整份计划树的节点与实际结果按位置拼接。
- `.local_expansion` 的 `{tree, plans}` 形状和恢复消息保留；旧 `tree` 仍是 legacy 计划投影，不被升级后冒充实际运行树。新增归档写入 run 目录，停止写共享的 Daemon `tree_*.json`；旧全局读取接口仍能读取历史文件。
- 新树只记录白名单来源/指标，不复制 `resume_messages`。树中的 `enqueued` 仅证明真实入队，完成状态、attempt 结果和 reward 留待第二阶段。
- 父节点晚到先保留在 `pending_nodes`，不临时挂到 query 根；恢复父节点后再连接。冲突或写入失败在日志和 manifest 中标为 degraded，不改变训练 reward。
- 批次结束前再尝试一次保存；仍失败时明确记录未保存树 ID 并释放批次内存，避免磁盘长期故障导致无限积压。已有成功快照不覆盖成半写文件，启动时从合法快照重建轻量摘要。历史错误保留，不自动宣称已完全修复。
- 核心检查使用 `mas\tests\test_rollout_tree.py`、`test_rollout_tree_archive.py` 和 `test_arpo_sampling_adapter.py`。Daemon 批量/增量方法通过 AST 加载实际方法体与假 Store 检查，不安装本地 GPU/VERL 栈；这不替代服务器导入、Ray 和实际入队验收。
- 服务器验收重点：分别启动普通 GRPO 与发生实际分支的 ARPO，检查 run 专属目录、不同采样组、预算裁剪、独立补采样和跨批次保留；此阶段文件没有最终 reward 是预期边界，不用它判断训练失败。

## Acceptance and Delivery Boundary

- 两个初始 rollout、两个 parent 各自的 child、独立补采样归入正确树。
- 计划跳过、预算截断、重复归档不会改变 child 的真实 parent。
- 同题另一个 run、另一个组和验证采样不会混入同一树。
- 父节点晚到、未知引用和环被明确识别，不发布伪造完整结构。
- 清理批次内存后，旧组树仍在；重启读取保持身份和 revision。
- 使用现有无 GPU 检查覆盖以上数据形状；真实训练只由用户明确启动。本阶段不宣称结果回填或 UI 完成。

## Risks and Edge Cases

- 重试 attempt 不创建新的采样分支；第二阶段处理结果覆盖规则。
- 单个 run 的树量仍可能较大，摘要仅存必要字段；不为第一版建设通用检索服务。
- query 是分组根，不参与梯度、执行次数、奖励均值或失败率计算。

## Next Phase

[第二阶段：结果回填与按运行读取](RolloutTree第二阶段-结果回填与按运行读取.md)。
