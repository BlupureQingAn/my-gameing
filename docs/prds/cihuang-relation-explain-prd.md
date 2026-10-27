# 《词谎》合规判定关系解说 PRD

- 日期：2026-10-27
- 状态：已与小徐五轮确认定案，待实施
- 涉及端：前端 `cihuang/`、离线数据 `cihuang/data/topics|game`、脚本 `scripts/cihuang_*`
- 不涉及：服务端 worker、PB 集合、出牌/质疑/轮盘/学习闭环规则

## 1. 背景

玩家反馈（词谎一游戏交流群，2026-10-27）：

> 创意好棒，但是词的相近性有一点牵强。我觉得有联系的系统判定没联系，我认为没联系的系统判定有联系。
> 不明白 class 和 year 为什么是相近词。

定位结果：

- hs 主题 `class` 的合规白名单为 `year / form / course / sort / division / category`，判定依据为 WordNet 近义边，其中 `class ↔ year` 依赖「年级」义项（year 1 / year 2 的用法）。
- 该词条在本局没有义项高亮（`senseMatch["year"] = []`），结算界面只显示一句「释义中没有直接对应义项，按近义关系判定合规」，玩家无从理解。
- 同一主题的干扰词池中包含 `college`（学院），语义强相关却被判不合规。原因是合规词来自近义词集，干扰词来自高频词随机池，两者筛选标准不对等。
- 五档主题实测：合规词共 6558 条，其中仅 2308 条（35%）有义项标注；50 个主题完全没有义项标注（hs 22 个）。标注脚本本身已全量运行，低覆盖率源于词库中文释义缺列对应义项，而非标注未执行。

本质问题：规则文案使用「相近性」，系统实现只认主题合规白名单，玩家按「语义相关」理解，三者不一致。

## 2. 目标

在不改变判定逻辑与合规白名单的前提下，让每一次翻开牌面都能回答两个问题：

1. 这张牌与本轮主题是什么关系（同义 / 语义相邻 / 无关）？
2. 这个关系落在双方的哪一个具体义项上？

同时统一教程、规则速览、质疑确认弹窗、结算翻牌四处口径，消除「系统说了算」的感受。

## 3. 已确认决策

| 决策点 | 结论 |
|---|---|
| 是否调整判定 | 不调整，合规仍由主题白名单决定 |
| 「语义相邻」地位 | 仅作解释用语，不作为判定标准，规则不承诺「凡相邻皆合规」 |
| 关系解说形式 | 每条牌一句人话，必须点名双方具体义项 |
| 关系类型 | 同义（same）与语义相邻（adjacent）均可出现在解说中 |
| 标注覆盖范围 | 五档全量（1093 个主题、6558 条合规词） |
| 解释不通的合规词 | 回数据修正：优先补词库义项，否则剔除并用同义补位；补不齐的主题下线 |
| 文案同步范围 | 教程、规则速览、质疑确认弹窗、结算翻牌四处 |
| 本轮不纳入 | 质疑流程、轮盘与名次、学习闭环、主题结构重组 |

## 4. 数据设计

### 4.1 主题新增字段

`cihuang/data/topics/{band}.json` 每个主题增加：

```json
{
  "explain": {
    "year": {
      "kind": "same",
      "topicSense": "年级",
      "wordSense": "年级",
      "source": "lexicon",
      "note": "class 的「年级」义与 year 的「年级」义相同"
    }
  },
  "nearMiss": ["college"],
  "topicSenses": ["班级", "年级", "类别"]
}
```

字段约束：

- `explain` 覆盖该主题全部 6 个合规词，每词一条，缺一条即视为数据缺陷。
- `kind` 取值 `same`（同义）或 `adjacent`（语义相邻）。
- `source` 取值 `lexicon`（词库释义中已有对应义项，可与 `senseMatch` 对齐）或 `external`（词库释义未单列，依据词典义判定，例如 year 的「年级」）。
- `note` 为中文一句话，点名双方义项，长度不超过 60 字。
- `nearMiss` 仅收录「与主题语义相邻、但不属于本局合规白名单」的干扰词；其余干扰词视为无关，不单独存储。
- `topicSenses` 汇总该主题本轮涉及的义项文本，用于主题卡展示；同一主题混多个义项时全部列出（仅透明化，不拆分数据）。

### 4.2 数据体积

- `explain`：6558 条 × 约 120 字节 ≈ 0.8 MB，分摊到五档每档约 0.16 MB。
- `nearMiss`：仅存相邻干扰词名单，预计每主题 0–5 个，总体小于 0.1 MB。
- `cihuang/data/game/*.json` 只承载词库与释义，不写入解说的英文内容；解说字段随主题数据下发，前端在翻开时按 `card.w` 查找。

### 4.3 词库释义修正

若关系成立但词库释义缺列该义项（如 year 缺「年级」）：

1. 优先在 `cihuang/data/game/{band}.json` 与对应 `banks` 中补入义项文本，并在 `explain.source` 标 `lexicon`；
2. 补义项只影响《词谎》自有词库展示，不改动主站语言学习词库；
3. 补义项后重跑标注脚本，使其进入 `senseMatch` 并可在牌面高亮。

无法补充且无法用现有义项解释的合规词，按第 7 节处理。

## 5. 交互设计

### 5.1 结算翻牌（`showReveal`）

合规牌：

- 释义区保留现有义项展示与琥珀色高亮；
- 释义下方增加关系说明行，例如：
  - `class 的「年级」义与 year 的「年级」义相同`
  - `year 的「年/年龄」与 class 的「年级」语义相邻`
- 当 `source = external` 时，说明行追加「（词库释义未单列）」；
- 原「按近义关系判定合规」提示仅作为无解说数据时的兜底文案保留。

不合规牌：

- 牌面判定标签保持「不合规」；
- 若词在 `nearMiss` 中，追加说明：`college 的「学院」与 class 的「班级」语义相邻，但不共享本局合规义项`；
- 其余干扰牌追加通用说明：`与 class 的本轮义项无关`。

万能牌：保持现有「无论本轮主题为何，万能牌始终视为合规」。

### 5.2 主题展示

主题卡除主题词外，展示 `topicSenses`，例如：

```
本轮主题  class
班级 / 年级 / 类别
```

用于提前告知玩家本轮判定可能覆盖的义项范围。

### 5.3 文案同步

- 教程：在判定说明步骤增加一句「合不合规由本局主题标注决定；翻牌时会说明双方对应的义项」。
- 规则速览：将「词的相近性」改为「与本轮主题共享义项或语义相邻，具体以主题标注为准」。
- 质疑前可见的主题牌（桌面中央）与公开作答弹窗：展示当前主题与 `topicSenses`，提示「质疑前请以上述义项范围为准」。质疑按钮本身无二次确认弹窗，按现有交互处理。

## 6. 实现方案

### 6.1 标注脚本

在 `scripts/cihuang_label_senses.py` 基础上新增 `scripts/cihuang_label_relations.py`：

1. 读取五档 topics 与 game 词库释义；
2. 对每个主题的 6 个合规词，向 DeepSeek 请求：
   - 关系类型（same / adjacent / none）
   - 主题侧义项、词条侧义项
   - 一句话中文说明
   - 是否仅凭词库释义即可成立
3. 对每个主题的干扰词做二分类：与主题语义相关 / 无关；仅把前者写入 `nearMiss`；
4. 结果按任务哈希缓存到 `F:\Claude\lexicon_build\cihuang_relation_cache.json`，支持断点续跑与 `--only` 单档重跑；
5. `--apply` 时写回 topics JSON，并输出统计：
   - `same` / `adjacent` / `none` 数量
   - 每档覆盖率（必须 100%）
   - `source=external` 清单（供词库补义项）
   - `none` 清单（进入数据修正流程）

模型与通道沿用现有脚本：`deepseek-chat`，密钥 `F:\Claude\deepseek-apikey`，批量请求、并发 4。

### 6.2 词库补义项脚本

新增 `scripts/cihuang_fix_glosses.py`：

- 输入 `source=external` 清单，输出待补义项建议；
- 人工确认后写回 `cihuang/data/game/{band}.json` 与 `cihuang/data/banks/{band}.json` 中被引用的词条；
- 不改动 ECDICT 源文件与主站语言词库。

### 6.3 数据分发与构建

前端同时加载 `cihuang/data/topics/{band}.json` 与 `cihuang/data/game/{band}.json`（`main.js` 的 `loadBand`），解说字段随 topics 文件直接下发，无需写入 game 数据。`build_game_data.mjs` 只负责词库紧凑化，本轮保持不改；数据 QA 由 `scripts/cihuang_qa_relations.py` 承担。

### 6.4 前端

- `cihuang/src/core/senses.js`：新增 `explainFor(topic, word)` 与 `nearMiss(topic, word)` 纯函数。
- `cihuang/src/ui/main.js`：
  - `showReveal` 增加关系说明行与不合规说明；
  - 主题卡渲染 `topicSenses`；
  - 教程与规则速览文案更新；
  - 质疑确认弹窗增加主题义项提示。
- `cihuang/src/style.css`：新增 `.reveal-explain` 样式，字号与现有 `.reveal-note` 一致，颜色区分同义（琥珀）与相邻（灰蓝）。
- 版本号：`index.html` 与 `service-worker.js` 同步 bump 至 `?v=20261027a`，`game.js` 重新用 esbuild 构建。

## 7. 异常处理流程

1. 标注结果 `kind = none` → 进入待修清单；
2. 优先判断能否通过补词库义项转为 `same`；
3. 不能补义项时，从该主题合规池剔除，并用 WordNet 同义边中的未选词补位，保持每组 6 条；
4. 补位后重新标注，仍失败则整组主题下线；
5. 每档主题数量不得低于 PRD 下限（hs 50 / cet4 100 / cet6 150 / ky 150 / toefl 150），跌破则暂停该档上线并回报小徐。

## 8. 验收与测试

### 8.1 数据校验

- 五档全部主题 `explain` 覆盖 6/6；
- `note` 非空且不超过 60 字；
- `kind=same` 必须同时提供 `topicSense` 与 `wordSense`；
- `nearMiss` 中的词必须位于该主题干扰池，且不得出现在合规池；
- 构建后每档 `game.json` 体积增量不超过 25%；
- 原有 QA（每组 6 合规、至少 17 干扰、无重复）继续通过。

### 8.2 单元测试

新增：

- `explainFor` 命中与缺失回退；
- 合规牌渲染说明行；
- `source=external` 追加提示；
- 不合规牌 `nearMiss` 说明与通用说明；
- 主题卡 `topicSenses` 渲染。

全量单测需保持现有 71 项通过。

### 8.3 线上验证

- 页面、SW、game.js、style.css 版本号一致且 200；
- 本地与服务器 md5 一致；
- 冒烟：`/api/cihuang/config` 200、entitlement 401、pay 401、旧 lexicon 404；
- 按小徐既有指示，本轮只做静态检查、单测与线上冒烟，不做浏览器 UI 实测。

## 9. 发布与回滚

发布：

1. 数据重建并本地 QA 通过；
2. 提交 `cihuang/` 与 `docs/prds/`（docs 需 `git add -f`）；
3. `git push origin main:main`；
4. `ssh pb "cd /var/www/bitlife && git pull origin main"`；
5. bump 后的资源冒烟。

回滚：

- 站点 `git revert <本次提交>` + push + 服务器 pull；
- 数据文件为提交内容，随 revert 回滚；
- worker 无改动，无需回滚；
- 旧数据备份：`F:\Claude\lexicon_build\backup\cihuang_topics_20261027.json`。

## 10. 风险

- 只改展示不改判定，玩家仍可能认为部分判定牵强；上线后重点观察质疑误判率与群反馈，若解释仍不被接受，升级方案为「义项绑定」（每轮锁定单一义项）或「收紧为同义词」。
- LLM 生成的义项与说明存在误标风险，需按 10% 抽样人工复核，重点检查 `same` 类。
- 词库补义项会改变玩家看到的释义文本，需在发布说明中标注。
- 数据体积增加约 1 MB，需确认五档单档加载体积仍满足首屏预算。
