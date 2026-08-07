# 北极星 Polaris

北极星把一个自然语言数据问题变成可保存、可拖拽、可刷新的实时 Web 数据组件。这是验证核心交互的 POC，不是完整数据平台。

## 本地启动

需要 Node.js 22.13 或更高版本。

```bash
npm install
cp .env.example .env.local
npm run dev
```

然后打开 `http://localhost:3000`。

在 `.env.local` 中配置：

```bash
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-5.6
```

API key 只在服务端 route 中读取。没有 key 时，界面会显示 `Missing key`，真实聊天生成会明确失败，但可以通过 `Load demo` 检查全部界面交互。

## 核心链路

1. 在右侧输入一个数据问题。
2. 服务端通过 OpenAI Responses API 和 hosted Web Search 获取当前数据。
3. Structured Outputs 生成经过 Zod 校验的 `WidgetSpec`。
4. 组件被加入画布，可拖拽、缩放、删除并保存到 `localStorage`。
5. Refresh 用原始问题重新查询；失败时保留旧数据。

支持 `table`、`line_chart`、`bar_chart` 和 `metric`。每个真实组件展示最多五个来自 API 响应的可点击来源。

## 验证

```bash
npm run lint
npm run typecheck
npm run test:schema
npm run build
```

## POC 边界

没有数据库、登录、多 dashboard、分享、定时刷新、connector 框架、任务队列或独立后端服务。Dashboard、布局和最近 20 条消息只保存在当前浏览器。
