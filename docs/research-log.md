# 迪尚校服设计提案系统 — 联网采集方案研究日志

> 记录从 2026-03-12 起，针对「院校信息采集准确率低」问题的所有尝试方案、使用模型、遇到问题及最终结论。

---

## 背景问题

系统原始方案依赖 LLM 的 `enable_search: true` 黑箱联网搜索。对知名院校效果尚可，但**小众院校（如池州学院、安阳工学院、鹰潭职业技术学院）准确率明显偏低**，主要表现为：

- 基本信息细节错误（创办年份、院校类型）
- 校训、校歌填写不准确甚至编造
- 部分字段直接返回「暂无」

---

## GeeKAI 可用接口概览

| 接口 | 端点 | 用途 |
|------|------|------|
| Chat Completions | `POST /chat/completions` | 标准 LLM 对话，支持 `enable_search` 黑箱联网 |
| Web Search | `POST /web_search` | 关键词搜索，返回 N 条摘要结果 |
| Web Fetch | `POST /web_fetch` | 传入 URL，返回完整页面正文 |
| Responses | `POST /responses` | OpenAI Responses API 格式，支持内置工具 |

---

## 方案演进记录

---

### 方案 0：原始方案（快速模式，持续保留）

**架构：**
```
用户输入学校名 → /chat/completions + enable_search: true → 返回结构化 JSON
```

**模型变更记录：**
- 初始：`claude-sonnet-4-6:thinking`
- 后改：`gpt-5.4-pro`（用户要求测试）

**问题：**
- `enable_search` 是平台黑箱，不知道搜了什么、搜了几次
- 小众学校搜索结果质量无法干预
- 无法追溯信息来源

**结论：** 保留为「快速模式」，作为精准模式的降级备选。

---

### 方案 1：web_search 显式搜索 + LLM 提取（精准模式 v1）

**架构：**
```
web_search (glm-search-std)
    ↓ 返回 N 条带摘要的搜索结果
/chat/completions (gpt-5.4-pro)
    ↓ 将搜索摘要注入 prompt，提取结构化 JSON
```

**搜索策略：** 按 8 个采集维度分组，每维度 2-3 个关键词组合，共约 17 个并行搜索请求。结果按 batch A/B/C 分组，3 个 LLM 批次并行提取。

**模型兼容性测试（web_search 接口）：**

| 模型 | 结果 |
|------|------|
| `glm-search-std` | ✅ 正常，小众学校结果相关性好 |
| `search-std` | ✅ 正常（别名） |
| `glm-search-pro` | ❌ 小众学校返回不相关内容（其他学校页面） |
| `gpt-5.4-pro` | ❌ 400 "invalid search llm model" |
| `gpt-5.4` | ❌ 400 同上 |
| `gpt-5-search-api` | ❌ 400 同上 |

**遇到的问题：**

1. **LLM 输出截断**：`max_tokens: 4000` 不够用，搜索上下文约 40k 字符，LLM 输出在 854 字处截断，Batch A/B 大量字段缺失。
   - 修复：改为 `max_tokens: 8000`

2. **代码质量问题（code review 发现）：**
   - `searchByDimensions` 中有 push 变异，改为 filter+map 函数式风格
   - refine 路由有重复的 fetch 逻辑，抽取为共享 `callWebSearch`

**结论：** 准确率明显提升，但信息深度受限于搜索摘要（每条约 200-500 字）。

---

### 方案 2：尝试加入 web_fetch（三步流水线 v1）

**架构设想：**
```
web_search → 获得 URL 列表
    ↓
web_fetch → 抓取 edu.cn 页面完整正文（优先级：edu.cn > baike > wikipedia）
    ↓
LLM 从完整页面提取结构化数据
```

**web_fetch 接口模型兼容性测试：**

| 模型 | 结果 |
|------|------|
| `jina-reader-v1` | ❌ 500 "服务端异常，请重试"（所有 URL 均失败） |
| `gpt-5.4-pro` | ❌ 400 "invalid web-fetch llm model" |
| `gpt-5.4` | ❌ 400 同上 |

**测试过的 URL（全部 500）：**
- `https://www.tsinghua.edu.cn/xxgk/xxjj.htm`
- `https://www.jxytxy.cn/html/898/`
- `https://www.jxytxy.cn/html/897/`
- `https://www.czu.edu.cn/xygk/xyjj.htm`

**结论：** GeeKAI `web_fetch` 服务端持续异常，无法使用。架构代码保留（`callWebFetch`、`fetchTopResults`），加入优雅降级：失败时跳过，仅用搜索摘要继续。

---

### 方案 3：/responses 接口 + 内置 web_search_preview（精准模式 v2）

**背景：** GeeKAI 供应商告知 `gpt-5.4-pro` 需要通过 `/responses` 接口使用（Responses API 格式）。

**架构：**
```
/responses (gpt-5.4-pro) + tools: [web_search_preview]
    → 模型自主决定搜什么、搜几次
    → 自动提取结构化 JSON
```

**测试结果（鹰潭职业技术学院）：**
- 自动发起 13-15 次搜索
- 信息准确，校训、历史节点、地址均正确
- 搜索结果带 edu.cn 来源

**致命问题：**

`gpt-5.4-pro` 是推理模型（thinking model），reasoning tokens 优先消耗 `max_output_tokens` 预算：

| max_output_tokens 设置 | reasoning tokens | 实际输出 |
|------------------------|-----------------|---------|
| 8000 | 8000 | 0（空） |
| 16000 | ~12000 | 部分（status: incomplete） |
| 20000 | ~全部 | 连接超时 / 空响应 |

**尝试解法：**
- `reasoning: { effort: "low" }` → 接口返回空响应（不支持该参数）
- 改用 `gpt-4o`（非推理模型）→ reasoning_tokens = 0，稳定输出
  - 缺点：每次只自主搜索 1 次，深度不如 `gpt-5.4-pro`

**结论：** `/responses + gpt-4o` 可用但搜索深度不足，`gpt-5.4-pro` 因 reasoning 问题无法直接用于大输出场景。

---

### 方案 4：显式三步流水线（当前方案，精准模式 v3）

**架构（用户最终提交版本）：**
```
Step 1: web_search (glm-search-std)
    → 按维度主动搜索，获得摘要 + URL 列表

Step 2: web_fetch (jina-reader-v1)
    → 抓取优先级最高的 URL 完整正文
    → 失败时优雅降级，跳过此步

Step 3: /responses (gpt-4o，无搜索工具)
    → 将 [搜索摘要 + 页面正文] 作为结构化证据注入 prompt
    → 仅从给定证据中提取，禁止补充证据外内容
```

**关键设计：`buildStructuredInput()` 结构化证据注入**
```
目标院校：{学校名}
请只依据下面给出的搜索证据进行结构化提取；若证据不足，填【暂无】，禁止补充证据外事实。

【输出 Schema】
{...JSON schema...}

【搜索摘要证据】
{web_search 返回内容}

【网页正文证据】
{web_fetch 返回内容，若可用}

再次强调：只输出 JSON，不要解释，不要重复来源列表。
```

**环境变量配置：**
```env
GEEKAI_MODEL=gpt-5.4-pro                  # 快速模式（黑箱搜索）
GEEKAI_PRECISE_MODEL=gpt-4o               # 精准模式提取
GEEKAI_PRECISE_REASONING_EFFORT=minimal   # 预留：未来换推理模型时控制 reasoning
```

**10 校验收测试结果（2026-03-17）：**

| 学校 | 类型 | 准确率 | 主要失分项 |
|------|------|--------|-----------|
| 清华大学 | 985 | 100% | — |
| 武汉大学 | 985 | 100% | — |
| 山东科技大学 | 省属重点 | 100% | — |
| 重庆邮电大学 | 行业特色 | 100% | — |
| 深圳职业技术大学 | 职业本科 | 100% | — |
| 安徽师范大学 | 省属师范 | 100% | — |
| 河北工业职业技术大学 | 双高职业 | 100% | — |
| 池州学院 | 地方应用型 | 75% | 校歌（官方未发布）、校色（无公开值）|
| 安阳工学院 | 地方应用型 | 75% | 校色（无公开值）、校友（官网未列）|
| 鹰潭职业技术学院 | 高职专科 | 75% | 校歌（未检索到）、校友（官网未列）|

**整体准确率：86.7%**

> 注：失分项基本符合实际情况——这些信息在官网本就不存在，AI 诚实返回「暂无」，与人工采集结论一致，不属于错误。

---

## 模型兼容性速查表

| 接口 | ✅ 可用模型 | ❌ 不可用 | 备注 |
|------|-----------|---------|------|
| `/web_search` | `glm-search-std`、`search-std` | `gpt-5.4-pro`、`gpt-5.4`、`gpt-5-search-api`、`gpt-4o` | 仅搜索专用模型 |
| `/web_fetch` | `jina-reader-v1` | `gpt-5.4-pro`、`gpt-5.4` | 服务端持续 500，待观察 |
| `/responses` | `gpt-4o`、`gpt-5.4-pro` | — | `gpt-5.4-pro` 有 reasoning token 问题 |
| `/chat/completions` | 几乎所有模型 | — | `gpt-5.4-pro` 可用，`enable_search` 黑箱 |

---

## 已知未解问题

### 1. web_fetch 服务端 500
- **现象**：所有 URL（包括 example.com）均返回 `{"message":"服务端异常，请重试"}`
- **两个端点均失败**：`geekai.co` 和 `geekai.dev`
- **当前处理**：优雅降级，`callWebFetch` 失败返回 null，不影响主流程
- **待跟进**：联系 GeeKAI 供应商确认服务状态

### 2. gpt-5.4-pro reasoning 吃空 token
- **现象**：推理模型的 reasoning tokens 优先消耗 max_output_tokens，实际内容输出为空
- **当前处理**：精准模式改用 `gpt-4o`
- **潜在方案**：等 GeeKAI 支持 `reasoning: { effort: "minimal" }` 参数后可重测

### 3. 小众院校信息本身缺失
- 部分院校官网确实没有公开校歌歌词、校友名单、标准色 HEX 值
- 这类「暂无」是正确答案，不属于系统问题
- 可考虑在 UI 上对此类字段标注「官方未公开」

---

## SSE 稳定性修复记录

**问题**：`controller.close()` 在某些路径下被多次调用，导致 SSE 流报错崩溃。

**修复**：在所有 SSE 路由（`collect`、`collect-precise`）加入 `streamClosed` 标志位：
```typescript
let streamClosed = false
const push = (event, data) => {
  if (streamClosed) return
  controller.enqueue(enc.encode(sseEvent(event, data)))
}
const closeStream = () => {
  if (streamClosed) return
  streamClosed = true
  controller.close()
}
```

**前端同步修复**：SSE 解析逻辑加入 `shouldStop` 标志位 + `decoder.decode()` flush，防止最后一帧数据丢失。

---

*最后更新：2026-03-17*
