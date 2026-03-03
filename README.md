# 迪尚校服设计提案 Demo

AI 驱动的校服设计提案生成工具 —— 输入学校名称，自动联网检索学校文化资料，生成包含设计主题、创意基石、视觉资产、设计逻辑和 AI 纹样建议的完整设计提案。

## 部署到 Vercel

### 第一步：推送代码到 GitHub

```bash
git init
git add .
git commit -m "feat: 迪尚校服设计提案 demo"
gh repo create school-brief-demo --public --push
```

### 第二步：在 Vercel 添加环境变量

进入 Vercel 项目设置 → **Environment Variables**，添加以下三个变量：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `GEEKAI_API_KEY` | 你的 GeeKAI Key | 必填 |
| `GEEKAI_BASE_URL` | `https://geekai.co/api/v1` | 国内用此地址；海外用 `https://geekai.dev/api/v1` |
| `GEEKAI_MODEL` | `gpt-4o` | **在这里切换模型**，见下方支持列表 |

### 第三步：部署

Vercel 会自动检测 Next.js 项目并部署，无需额外配置。

---

## 模型配置说明

只需修改 `GEEKAI_MODEL` 环境变量即可切换模型，无需改代码：

| 模型名称 | 特点 |
|----------|------|
| `gpt-4o` | 推荐，综合能力强，联网搜索质量好 |
| `gpt-4o-mini` | 速度快，成本低，适合频繁演示 |
| `claude-3-5-sonnet-20241022` | 文字输出质量高，适合设计话术 |
| `claude-3-7-sonnet-20250219` | 最新 Claude，推理能力更强 |
| `gemini-1.5-pro` | Google 模型，搜索整合好 |

---

## 本地开发

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量（填入你的 GEEKAI_API_KEY）
# 编辑 .env.local

# 3. 启动开发服务器
npm run dev
# 访问 http://localhost:3000
```

## 项目结构

```
app/
├── page.tsx              # 主页面（搜索框 + 结果展示）
├── types.ts              # TypeScript 类型定义
├── api/
│   └── brief/
│       └── route.ts      # GeeKAI API 调用（联网搜索 + AI 生成）
└── components/
    └── BriefResult.tsx   # 设计提案展示组件
```
