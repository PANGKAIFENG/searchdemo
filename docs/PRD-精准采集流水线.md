# PRD · 院校信息精准采集流水线

> 版本：v3（当前实现）
> 更新日期：2026-03-18
> 接口路径：`POST /api/collect-precise`
> 目标读者：接手开发的工程师

---

## 一、产品目标

输入学校名称，系统自动联网采集 8 个维度的院校文化资料，用于迪尚校服设计提案。

**8 个维度：**

| 字段 key | 维度名称 | 说明 |
|---------|---------|------|
| `basic` | 院校基本面 | 全称、简称、创办年份、地址、500字简介 |
| `culture` | 学校文化灵魂 | 校训、校歌（含歌词）、办学愿景、核心精神 |
| `symbols` | 符号语义块 | 校徽描述、校旗说明、标准色（含 HEX） |
| `history` | 历史时间轴 | 重要历史事件（≥5条带年份）、知名校友 |
| `landmarks` | 核心地标语义 | 标志性建筑、石刻碑文、著名雕塑 |
| `ecology` | 生态环境语义 | 校花校树、校园自然景观 |
| `academics` | 荣誉与学科 | 优势学科（≥5个）、重大科研成果 |
| `marketing` | 营销话术采集 | 校长寄语、校园口号、B2B项目亮点（3条） |

---

## 二、接口规范

### 请求

```
POST /api/collect-precise
Content-Type: application/json

{ "school_name": "复旦大学" }
```

### 响应：Server-Sent Events（SSE）

响应为 `text/event-stream`，持续推送直到结束。共有三种事件类型：

#### `event: progress`
```
event: progress
data: {"step": "搜索并提取基本面、校史与学术信息…"}
```
进度提示，仅供前端展示。

#### `event: error`
```
event: error
data: {"error": "采集失败：Chat Completions API failed (429): ..."}
```
出现此事件后流即关闭，无 result 事件。

#### `event: result`
```
event: result
data: {
  "school_name": "复旦大学",
  "school_data": { ...SchoolData },
  "data_quality": { ...DataQuality },
  "image_search_hints": { "emblem": [...], "landmark": [...], "scenery": [...] },
  "citations": ["https://www.fudan.edu.cn/...", ...]
}
```

**SSE 消费示例（前端）：**
```javascript
const resp = await fetch('/api/collect-precise', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ school_name: '复旦大学' }),
})

const reader = resp.body.getReader()
const decoder = new TextDecoder()
let buf = ''

while (true) {
  const { done, value } = await reader.read()
  if (done) break
  buf += decoder.decode(value, { stream: true })
  const lines = buf.split('\n')
  buf = lines.pop()
  // 解析 event / data 行对...
}
```

---

## 三、完整执行流水线

```
输入: "复旦大学"
    │
    ▼
[并行] Batch A + B + C  ←──── Perplexity 通道（仅 B）
    │  各 Batch 内部：
    │  1. searchByDimensions()   → GeeKAI 搜索 + Serper 兜底，按维度并行
    │  2. fetchTopResults()      → Jina Reader 直连抓取，优先 edu.cn
    │  3. formatFetchResultsWithWindows() → 关键词窗口截取（每页≤3000字符）
    │  4. callChatCompletions()  → GeeKAI /chat/completions + json_object
    │  5. extractJSON()          → 解析，失败触发 repairSectionOutput()
    │  6. Perplexity 覆盖（仅 B）
    │
    ▼
合并 A+B+C 结果（Object.assign 浅合并）
    │
    ▼
[Vision 兜底] standard_colors 无有效 HEX？
    ├─ 是 → searchEmblemImageUrl() + extractColorsViaVision() → 写入 L5 标注
    └─ 否 → 跳过
    │
    ▼
[串行] Batch D：营销话术推断（基于 A/B/C 结果）
    │
    ▼
calcDataQuality() → 完整性评分 + 来源置信度
    │
    ▼
SSE result 事件推送
```

---

## 四、搜索层详细设计

### 4.1 搜索策略（`app/lib/web-search.ts`）

每个维度有独立的搜索 query 列表：

| 维度 | 搜索 query 示例 | 域名过滤 |
|------|---------------|---------|
| `basic` | `{名} 学校简介 办学定位` | `edu.cn` |
| `basic` | `{名} 百度百科 学校概况` | `baike.baidu.com` |
| `culture` | `{名} 校训 校歌 歌词 全文` | `edu.cn` |
| `culture` | `{名} 校歌歌词 完整版` | 无 |
| `symbols` | `{名} 校徽 校旗 标准色 VIS 视觉识别` | `edu.cn` |
| `symbols` | `{名} 校徽颜色 主色调 品牌色` | `baike.baidu.com,zh.wikipedia.org` |
| `symbols` | `{名} 校徽 颜色 HEX RGB` | 无 |
| `history` | `{名} 大事记 发展历程 历史沿革` | `edu.cn` |
| `landmarks` | `{名} 标志性建筑 校园地标 代表建筑物` | 无 |
| `ecology` | `{名} 校花 校树 官方认定 校园植物` | 无 |
| `academics` | `{名} 优势学科 重点专业 学科评估 国家级` | 无 |
| `marketing` | `{名} 校长寄语 校园口号 学校精神` | 无 |

### 4.2 双路搜索 + 去重合并

每条 query 并行调用两路：
1. **GeeKAI `glm-search-pro-sogou`**（配置在 `GEEKAI_SEARCH_MODEL_CHAIN`，支持多模型兜底链）
2. **Serper.dev `/search`**（`SERPER_API_KEY`）

两路结果以 URL 去重合并，最终条数约为单路的 1.5~2 倍。

**GeeKAI 搜索 API 调用：**
```
POST {GEEKAI_BASE_URL}/web_search
Authorization: Bearer {GEEKAI_API_KEY}

{
  "model": "glm-search-pro-sogou",
  "prompt": "复旦大学 校训 校歌 歌词 全文",
  "intent": true,
  "count": 5,
  "domain_filter": "edu.cn",
  "content_size": "high",
  "recency_filter": "noLimit"
}
```

### 4.3 Batch 分组与并行

| Batch | 维度 | 并行策略 |
|-------|------|---------|
| A | basic、history、academics | 与 B/C 并行 |
| B | culture、symbols | 与 A/C 并行，同时跑 Perplexity |
| C | landmarks、ecology、marketing | 与 A/B 并行 |
| D | 无（纯推断） | 等 A/B/C 全部完成后串行 |

Batch A 抓取最多 **6** 个页面，B/C 各 **5** 个页面。

---

## 五、抓取层详细设计

### 5.1 URL 优先级排序

按域名评分（edu.cn=100 > baike=80 > wikipedia=70 > 其他=50）取 top-N。

### 5.2 双路抓取 + 兜底链

```
Jina Reader 直连（主）
  GET https://r.jina.ai/{url}
  Headers:
    Accept: application/json
    X-Return-Format: text
    X-Remove-Selector: header, footer, nav, aside, script, style
    X-Locale: zh-CN
    X-Engine: browser    ← 仅 edu.cn、baike 等需 JS 渲染的域名
    Authorization: Bearer {JINA_API_KEY}   ← 可选，有则更稳定

失败时 → GeeKAI web_fetch（兜底）
  POST {GEEKAI_BASE_URL}/web_fetch
  { "model": "jina-reader-v1", "url": "...", "engine": "browser", "timeout": 20 }
```

### 5.3 关键词窗口截取（减少 token）

拿到全文后，**不传全文给 LLM**，而是按 section 关键词截取证据窗口：

```typescript
const SECTION_KEYWORDS = {
  basic:     ['简介', '概况', '地址', '校区', '创办', '建校'],
  culture:   ['校训', '校歌', '精神', '愿景'],
  symbols:   ['校徽', '校旗', '校色', 'VI', '视觉识别', '标准色'],
  history:   ['历史沿革', '大事记', '更名', '升格', '合并'],
  landmarks: ['地标', '校门', '图书馆', '礼堂', '建筑'],
  ecology:   ['校花', '校树', '景观', '湖', '山'],
  academics: ['学科', '科研', '成果'],
  marketing: ['校长', '寄语', '昵称', '口号'],
}
```

算法：
- 每个命中关键词：前 320 字符 + 后 680 字符 = 最多 1000 字符/窗口
- 跳过与已有窗口重叠的范围
- 最多取 3 个窗口，拼接后 `slice(0, 3000)`
- 无关键词命中时兜底 `slice(0, 2600)`

**效果**：每页从原来最多 8000 字符降到 ≤3000 字符，token 减少约 60%。

---

## 六、LLM 提取层详细设计

### 6.1 主调用：callChatCompletions

```
POST {GEEKAI_BASE_URL}/chat/completions
Authorization: Bearer {GEEKAI_API_KEY}

{
  "model": "gpt-4o",          ← GEEKAI_PRECISE_MODEL 环境变量
  "messages": [
    { "role": "system", "content": "{instructions}" },
    { "role": "user",   "content": "{buildStructuredInput(...)}" }
  ],
  "temperature": 0.1,
  "max_tokens": 30000,
  "response_format": { "type": "json_object" },
  "enable_search": false       ← 关闭模型联网，只用传入证据
}

响应取：data.choices[0].message.content（直接是 JSON 字符串）
```

### 6.2 System Prompt（各 Batch 共用规则）

```
你是院校文化资料采集专家。⚠️ 输出规则：
- 只输出合法 JSON，直接以 { 开头，以 } 结尾
- 禁止任何 markdown、代码块标记、说明文字
- JSON 字符串值内禁止用英文双引号 " 引用词语，改用【】或「」
- 所有信息必须有搜索来源依据，找不到的填【暂无】，禁止编造
- 不要把来源 URL 直接拼接到自然语言字段正文中
- 仅在 schema 已提供 source_url 的字段中填写来源链接
- 全局来源链接会由系统从搜索 annotations 自动汇总，无需额外输出说明
```

### 6.3 User Prompt 模板（buildStructuredInput）

```
目标院校：{schoolName}
请只依据下面给出的搜索证据进行结构化提取；若证据不足，请按 schema 规则填【暂无】，禁止补充证据外事实。

【输出 Schema】
{batch.input(schoolName)}   ← 各 Batch 独立 schema（见 6.4）

【搜索摘要证据】
=== 来源 1: 标题 (URL) ===
内容摘要...

【网页正文证据】
=== 完整页面 1: 标题 (URL) ===
关键词窗口截取后的内容（≤3000字符/页）...

再次强调：只输出 JSON，不要解释，不要重复来源列表。
```

### 6.4 各 Batch 的输出 Schema

#### Batch A：基本面 + 校史 + 学科

```json
{
  "basic": {
    "full_name": "学校全称",
    "short_name": "常用简称",
    "founded_year": "创办年份（如1898）",
    "location": "地理位置（如中国·北京）",
    "introduction": {
      "value": "院校简介，约500字，涵盖历史沿革、办学定位、总体规模、核心优势",
      "status": "confirmed|inferred|insufficient",
      "confidence": 0.9,
      "source_url": "来源 URL",
      "source_level": "L1|L2|L3|L4|L5"
    }
  },
  "history": {
    "timeline": [
      { "year": "年份", "event": "该年发生的重要历史事件，20-40字", "source_url": "事件来源URL（找到则填）" }
    ],
    "notable_alumni": "代表性校友名单，3-8人，格式：姓名（身份）"
  },
  "academics": {
    "strong_disciplines": {
      "value": "强势学科或优势专业（至少5个），逗号分隔",
      "status": "confirmed|inferred|insufficient",
      "confidence": 0.8,
      "source_url": "来源 URL",
      "source_level": "L1|L2|L3|L4|L5"
    },
    "major_achievements": "重大科技成果或获奖（2-4条），逗号分隔"
  }
}
```

> **额外约束**：`timeline` 至少 5 条含年份的历史事件；`notable_alumni` 只列搜索中明确出现的真实人物。

#### Batch B：文化灵魂 + 符号语义

```json
{
  "culture": {
    "motto": {
      "value": "校训原文（逐字提取，不可意译）",
      "status": "confirmed|inferred|insufficient",
      "confidence": 0.95,
      "source_url": "来源 URL",
      "source_level": "L1|L2|L3|L4|L5"
    },
    "school_song": {
      "title": "校歌歌名（找不到则填【暂无】）",
      "lyrics_excerpt": "歌词节选，优先完整歌词；若找不到官方完整歌词则填节选并注明【暂无完整歌词】；完全找不到则填【暂无】",
      "completeness": "full|partial|not_found",
      "status": "confirmed|inferred|insufficient",
      "confidence": 0.8,
      "source_url": "来源 URL",
      "source_level": "L1|L2|L3|L4|L5"
    },
    "vision": "办学愿景（官方表述）",
    "core_spirit": "核心精神关键词（3-5个，如：爱国、进步、民主、科学）"
  },
  "symbols": {
    "emblem_description": {
      "value": "校徽官方释义，描述图形构成与寓意",
      "status": "confirmed|inferred|insufficient",
      "confidence": 0.85,
      "source_url": "来源 URL",
      "source_level": "L1|L2|L3|L4|L5"
    },
    "flag_description": "校旗说明，描述颜色、图案与象征（找不到则填【暂无】）",
    "standard_colors": [
      {
        "name": "颜色中文名（官方命名优先）",
        "hex": "#XXXXXX（必须为 #RRGGBB 格式，来源中有明确值时才填写）",
        "rgb": "R___ G___ B___（与 hex 一致）",
        "usage": "primary|secondary|accent",
        "source_level": "L1|L2|L3|L4|L5",
        "source_url": "颜色信息来源 URL",
        "confidence": 0.9,
        "is_official": true,
        "conflict": false,
        "conflict_note": "",
        "extraction_note": ""
      }
    ]
  }
}
```

> **标准校色专项规则**：
> - 有官方 VI 手册 / 学校官网明确声明 → `status: confirmed`
> - 有颜色名称无 HEX → `status: inferred`，`source_level: L3` 或更低
> - 官方声明未公开 → `standard_colors: [{ "name": "官方未公开", "status": "officially_not_public" }]`
> - 完全找不到 → `standard_colors: []`
> - 禁止猜测 HEX 值

#### Batch C：地标 + 生态

```json
{
  "landmarks": {
    "buildings": "标志性建筑名称，逗号分隔（至少3处，搜索来源中提到的真实建筑）",
    "stone_carvings": "非遗石刻或碑文，无则填【暂无】",
    "sculptures": "校园著名雕塑，无则填【暂无】"
  },
  "ecology": {
    "plants": {
      "value": "校花/校树名称及象征（未找到则填【该校暂无官方认定校花校树】）",
      "status": "confirmed|inferred|insufficient",
      "confidence": 0.9,
      "source_url": "来源 URL（找不到则留空字符串）",
      "source_level": "L1|L2|L3|L4|L5"
    },
    "geography": "校园湖泊、山丘、河流等自然地理要素"
  },
  "image_search_hints": {
    "emblem": ["{schoolName} 校徽 官方 高清"],
    "landmark": ["{schoolName} 具体地标1", "{schoolName} 具体地标2"],
    "scenery": ["{schoolName} 校园风景", "{schoolName} 航拍"]
  }
}
```

> **注意**：`image_search_hints.landmark` 中的地标名称必须来自 `landmarks.buildings` 中的真实地标。

#### Batch D：营销话术（推断，不搜索）

System prompt 改为：`你是院校品牌营销文案专家，擅长将院校文化特色转化为 B2B 提案语言。`

User prompt 中不传搜索证据，而是注入 A/B/C 的采集结果（取前 6000 字符）：

```
目标院校：{schoolName}
请只依据下面给出的搜索证据进行结构化提取...

【搜索摘要证据】
以下是已从权威来源采集到的{schoolName}院校信息（请基于此归纳，不要重新搜索）：

{JSON.stringify(mergedABC.data, null, 2).slice(0, 6000)}
```

输出 Schema：

```json
{
  "marketing": {
    "president_message": "校长寄语核心句，50字以内（根据学校特色和愿景推断，注明「推断」）",
    "campus_slogan": "校园流行语或非官方口号（可来自已知文化资料）",
    "student_nickname": "学生对母校的昵称或情感称呼",
    "b2b_highlights": [
      "B端项目亮点1（面向企业采购，20-40字，突出历史、学科、文化特色）",
      "B端项目亮点2（强调校园氛围、标志性元素）",
      "B端项目亮点3（突出荣誉、影响力）"
    ]
  }
}
```

### 6.5 JSON 解析与 repair 机制

```
extractJSON(text)
  ├─ 成功 → 直接使用
  └─ 失败 → repairSectionOutput(brokenText)
              调用同一 LLM，prompt：
              "以下 JSON 格式有误，请修复并只输出合法 JSON：\n{brokenText.slice(0,4000)}"
              ├─ 成功 → 使用修复结果
              └─ 失败 → 该 Batch throw，不影响其他 Batch
```

---

## 七、Perplexity 补充通道（Batch B 并行）

针对 `standard_colors` 和 `school_song` 两个难抓字段，与 Batch B 并行调用 Perplexity。

```
POST https://api.perplexity.ai/chat/completions
Authorization: Bearer {PERPLEXITY_API_KEY}

{
  "model": "sonar-pro",
  "messages": [
    {
      "role": "system",
      "content": "你是院校信息提取专家，只输出合法 JSON..."
    },
    {
      "role": "user",
      "content": "请搜索【复旦大学】的标准校色（官方颜色名称、HEX 值、RGB 值及用途），按照以下 schema 提取..."
    }
  ],
  "search_domain_filter": [".edu.cn", "baike.baidu.com", "zh.wikipedia.org"],
  "search_language_filter": ["zh"],
  "response_format": { "type": "json_schema", "json_schema": { "schema": {...} } },
  "max_tokens": 2000,
  "temperature": 0.1
}
```

**覆盖规则**（在 Batch B 提取结果基础上）：
- 若 Perplexity 返回的 `standard_colors` 数组非空 → 覆盖 Batch B 的结果
- 若 Perplexity 返回的 `school_song` 中有歌词，且 Batch B 的 `school_song.lyrics_excerpt` 为空或【暂无】→ 覆盖

**开关**：`PERPLEXITY_ENABLED=true` + `PERPLEXITY_API_KEY=xxx`（两者都需要配置才生效）

---

## 八、Vision 兜底：校徽图像主色提取

**触发条件**：A/B/C 合并后，`symbols.standard_colors` 中无任何合法 HEX（`/^#[0-9A-Fa-f]{6}$/`）。

**关闭开关**：`EMBLEM_VISION_FALLBACK_ENABLED=false`

### Step 1：搜索校徽图片

```
POST https://google.serper.dev/images
X-API-KEY: {SERPER_API_KEY}

{ "q": "复旦大学 校徽 官方 高清", "num": 8, "gl": "cn", "hl": "zh-cn" }
```

优先取 `.edu.cn` 来源的 HTTPS 图片 URL；无则取首个非 news/photo/banner 的 HTTPS URL。

### Step 2：Vision LLM 提取主色

```
POST {GEEKAI_BASE_URL}/chat/completions
{
  "model": "gpt-4o",
  "messages": [
    {
      "role": "system",
      "content": "你是专业的品牌色彩分析师，专注于提取校徽/Logo的标准色。只输出合法 JSON..."
    },
    {
      "role": "user",
      "content": [
        { "type": "image_url", "image_url": { "url": "https://...", "detail": "low" } },
        { "type": "text", "text": "这是【复旦大学】的校徽图片。请分析图片，提取 2-3 个主要颜色，输出如下 JSON：\n{\"colors\": [{\"name\": \"颜色中文名\", \"hex\": \"#RRGGBB\", \"rgb\": \"R___ G___ B___\", \"usage\": \"primary\"}]}\nusage 枚举值：primary / secondary / accent\n不要提取白色（#FFFFFF）和纯黑（#000000）作为主色。" }
      ]
    }
  ],
  "temperature": 0.1,
  "max_tokens": 1000,
  "response_format": { "type": "json_object" }
}
```

### Step 3：写入 standard_colors（L5 标注）

```json
{
  "name": "学院蓝",
  "hex": "#005BAC",
  "rgb": "R0 G91 B172",
  "usage": "primary",
  "source_level": "L5",
  "source_url": "https://...（校徽图片原始URL）",
  "confidence": 0.5,
  "is_official": false,
  "conflict": false,
  "extraction_note": "图像提取，非官方标准色，仅供参考"
}
```

---

## 九、来源置信度分级（source_level）

| 等级 | 来源类型 | confidence 参考值 |
|-----|---------|----------------|
| L1 | 学校官方 VIS 手册 / 官网主要栏目 | 0.9~1.0 |
| L2 | edu.cn 子页面（部门、院系页） | 0.75~0.9 |
| L3 | 百科（baike.baidu.com、zh.wikipedia.org） | 0.6~0.75 |
| L4 | 权威媒体（人民网、新华网等） | 0.5~0.7 |
| L5 | 其他来源 / 图像提取 / AI 推断 | 0.3~0.5 |

---

## 十、数据质量评分（DataQuality）

`calcDataQuality()` 在 result 事件中返回：

```typescript
{
  completeness_score: number    // 0-100，8维度加权平均
  confidence_score: number      // 0.0-1.0，citations 域名权重均值
  verdict: '通过' | '需补查'   // completeness≥80 且 confidence≥0.7 时为"通过"
  dimension_scores: {           // 各维度评分明细
    basic: { score, missing_fields, warnings },
    culture: { ... },
    // ...
  }
  missing_fields: string[]      // 全局缺失字段列表
  low_confidence_warnings: string[]
  recommended_queries: string[] // 补查推荐搜索词
  insufficient_fields: string[] // confidence < 0.5 的字段路径
}
```

**各维度权重**：`basic × 1.5、culture × 1.5、symbols × 1.5`，其余各 `× 1.0`。

---

## 十一、环境变量清单

| 变量名 | 必须 | 说明 |
|-------|------|------|
| `GEEKAI_API_KEY` | ✅ | GeeKAI API Key |
| `GEEKAI_BASE_URL` | ✅ | 默认 `https://geekai.co/api/v1` |
| `GEEKAI_PRECISE_MODEL` | | 精准模式 LLM，默认 `gpt-4o` |
| `GEEKAI_MODEL` | | 快速模式 LLM，默认 `gpt-4o` |
| `GEEKAI_SEARCH_MODEL_CHAIN` | | 搜索模型链，默认 `glm-search-pro-sogou` |
| `GEEKAI_FETCH_MODEL_CHAIN` | | 抓取模型链，默认 `jina-reader-v1` |
| `SERPER_API_KEY` | | Serper.dev，双路搜索 + 搜图用 |
| `JINA_API_KEY` | | Jina Reader，有则更稳定 |
| `PERPLEXITY_API_KEY` | | Perplexity，school_song/color 补充通道 |
| `PERPLEXITY_ENABLED` | | `true` 启用 Perplexity 通道 |
| `EMBLEM_VISION_FALLBACK_ENABLED` | | `false` 关闭 Vision 图像兜底，默认开启 |
| `PHASE3_CITATION_DISCOVERY_ENABLED` | | `true` 启用 Citation Discovery（实验性），默认关闭 |

---

## 十二、关键文件路径

```
app/
├── api/
│   ├── collect-precise/route.ts     主流水线（本文档重点）
│   ├── collect/route.ts             快速模式（LLM 直联网搜索）
│   ├── collect/refine/route.ts      补查接口（缺失字段二次采集）
│   └── images/route.ts             图片搜索接口（Serper Images API）
├── lib/
│   ├── web-search.ts               搜索 + 抓取 + 关键词窗口截取
│   ├── emblem-color-extraction.ts  Vision 校徽图像主色提取
│   ├── perplexity-search.ts        Perplexity 补充通道
│   ├── quality-check.ts            数据完整性与置信度评分
│   ├── citation-discovery.ts       Citation URL 发现（实验性 Phase 3）
│   └── utils.ts                    extractJSON、deepMerge 等工具函数
└── types.ts                        SchoolData、DataQuality 等全局类型
```

---

## 十三、已知局限

| 场景 | 表现 | 根因 |
|------|------|------|
| 小众院校 | standard_colors 无官方 HEX，Vision 兜底为 L5 | 学校未公开 VI 手册 |
| 校歌歌词 | completeness=partial 或 not_found | 歌词通常不在官网主页，需专项搜索 |
| 耗时 | 20-110 秒（视学校知名度） | 并行 3 批次但每批需搜索+抓取+LLM |
| 精准度 | 部分字段 confidence 偏低 | 来源为百科或推断 |
