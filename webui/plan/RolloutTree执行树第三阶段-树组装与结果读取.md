# Plan

把同一题目采样组的节点组装成一棵 RolloutTree，并接通按 run 读取树和节点内容的接口。复用现有 Recorder、归档和 API，不增加另一套图服务。

状态：代码已接入，核心组装、旧数据与 HTTP 检查通过；服务器持久读取待验收。依赖 [第一阶段](RolloutTree执行树第一阶段-节点与数据结构.md) 和 [第二阶段](RolloutTree执行树第二阶段-执行过程记录.md)。

## Requirements

- 所有 initial rollout 和独立补采样都从同一问题根开始，各自形成独立路径。
- child 的第一个新节点接到真实分支位置，而非父最终答案之后。
- 节点按真实执行关系连接，不按日志时间、答案相似度或列表顺序猜测。
- 父路径和 child 各自保留结束节点及结果。
- 树只存摘要，节点全文按需读取。

## Proposed Architecture

### 组装规则

1. 首次看到题目采样组，创建 Query 根节点。
2. initial/independent_fill 的首节点接 Query，其余按已记录的执行顺序连接。
3. child 来源由实际入队信息与恢复快照共同确认。第一个新节点从来源执行节点出口接出，之后按自己的顺序连接。
4. 原路径不删除、不折断；其结束节点仍保留原答案和最终奖励。
5. 并行工具同组展开，完成后连接到真实后续执行；这些普通执行边不是 branch 边。
6. planned 但未实际入队的候选不画成已经执行的路径。入队但尚未开始的候选可显示等待提示，不制造 Agent 内容。

同一节点更新始终复用 node_id，避免轮询产生重复节点。来源尚未读取到时暂标“来源待确认”，不能随意接到 Query 或其他相同名字的 Agent。

### 复用持久化

仍在现有 run 的 `rollout-trees` 下保存树，Archive 保存执行详情。树写入沿用现有原子替换，图形布局不存进后端数据。

Daemon/Recorder 是树的唯一写入者；Control 只读。重启后可以根据已登记节点重新合并，不引入独立 checkpoint 服务、双份图快照或事件重放平台。

只合并当前相关 rollout/attempt 的更新，不每次刷新扫描所有历史运行。正文不复制进树，避免每多一个节点就复制一遍完整历史输入。

### 最小 API 扩展

保留现有按 run 的题目列表和树详情路由，新增一个节点详情入口即可：

| 接口 | 返回内容 |
| --- | --- |
| 现有树列表 | 题目、采样数量、分支数量、运行状态 |
| 现有树详情 | v2 来源树或 v3 执行树，带明确版本和现有分页信息 |
| `.../rollout-trees/{tree_id}/nodes/{node_id}` | 节点详情、真实输入输出及必要的有界长内容读取 |

不增加独立 Gate 查询、任意文件读取或通用 Trace 接口。服务端使用注册 run 和节点引用查详情，校验归属，不直接接受文件路径。

复用 ETag、revision 和既有分页上限。版本变化时不拼接不同版本的页；大记录注明未加载范围，不能将当前页冒充整棵树。

### 结果与旧数据

结果复用已有 `RunnerResult` 和 reward 回填，仅将其关联到正确的结束节点。训练接纳状态继续属于 rollout/attempt，不因为画了多个过程节点而重复统计。

新 run 只写 v3；旧 v2 按旧结构读取，明确未保存逐节点过程。现有依赖树结构的读取方必须按版本处理，不能用旧节点粒度计算新树的 credit 或诊断；本轮不新增这些算法。

## Files and Entry Points

| 文件或区域 | 职责 |
| --- | --- |
| `mas\workflow\rollout_tree.py` | v3 节点与连线组装、结果关联及旧版本读取 |
| `rl\hooks\rollout_tree.py` | 合并 Runner 节点、Store 状态和结果 |
| `rl\hooks\daemon.py` | 提供实际 child 与来源节点/快照关系 |
| `science_infra\control\rollout_trees.py` | 版本化读取及节点详情入口 |

## Action Items

- [x] 实现 initial、独立补采样和 child 的连接规则。
- [x] 关联各条路径的结束结果，保持采样数量统计不变。
- [x] 复用现有归档与分页，增加节点详情读取。
- [x] 兼容旧记录，不从旧答案补造过程。

## Implementation Notes

- 2026-09-28：`execution_tree.py` 负责组装元数据，现有 `RolloutTreeArchive` 仍是树写入者。索引按修改时间缓存，批次释放时清理，不反复读取节点全文。
- Control 启动的新训练指定 `TIR_EXECUTION_TREE_VERSION=3`；旧 run 保持原版本。目录摘要格式独立于单棵树版本，不为新训练双写来源树与执行树。
- 新节点详情接口为 `.../rollout-trees/{tree_id}/nodes/{node_id}`；原树详情支持 `node_id` 直达定位，包含必要祖先和已加载边。结果统计按 rollout 计算，不把过程节点数当生成数。
- v3 不套用旧 rollout 粒度的 credit 诊断；接口明确返回尚不支持。来源不完整的 child 保留记录问题，不伪造 Query 连线或共享前缀。

## Acceptance and Delivery Boundary

两个 initial rollout、其中一个真实分支的记录能组成正确树；公共前缀只有一份，原路径和 child 各自到达自己的结束结果。刷新和重读不增添重复节点，不串 run/attempt，旧数据仍可查看。

## Next Phase

[第四阶段：横向树与节点详情](RolloutTree执行树第四阶段-横向树与节点详情.md)。
