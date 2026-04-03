# TheMatrix

> 生产级多智能体工作流编排系统

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)

TheMatrix 是一个用于构建、运行和管理多智能体 AI 工作流的生产级编排系统。灵感来自 Claude Agent SDK，提供了 DAG 和状态机两种工作流模式，支持事件溯源、可观测性和企业级可靠性。

## ✨ 核心特性

- 🤖 **多智能体编排**: 定义和编排多个 AI Agent，支持并行和串行执行
- 📊 **工作流模式**: 支持 DAG（有向无环图）和状态机两种工作流模式
- 💾 **事件溯源**: 所有状态变更都以事件形式持久化，支持审计和重放
- 📈 **可观测性**: 内置指标收集、健康检查和 Prometheus 集成
- 🔄 **容错机制**: 自动重试、错误分类、优雅降级
- 🔌 **多 LLM 支持**: Anthropic Claude、OpenAI GPT、Mock LLM（测试用）
- 🛡️ **生产级**: 配置管理、安全性、资源限制、监控告警

## 🚀 快速开始

### 安装

```bash
# 克隆仓库
git clone https://github.com/theneoai/thematrix.git
cd thematrix

# 安装依赖
pnpm install

# 构建
pnpm build
```

### 初始化项目

```bash
# 创建新项目
matrix init my-project
cd my-project

# 查看创建的 Agent
matrix agent list

# 验证配置
matrix agent validate agents/hello.agent.yaml
matrix workflow validate workflows/hello.workflow.yaml

# 运行工作流
matrix workflow run hello-world --input input.json
```

### 定义 Agent

创建 `agents/analyzer.agent.yaml`:

```yaml
id: code-analyzer
name: Code Analyzer
version: "1.0.0"

persona:
  systemPrompt: |
    You are a code analysis expert. Your job is to analyze code and identify issues.
  personality: "thorough and analytical"
  role: code-analyzer
  temperature: 0.2
  traits:
    expertise: "static analysis"

model:
  provider: anthropic
  model: claude-3-sonnet-20240229
  apiKeyEnvVar: ANTHROPIC_API_KEY
  maxTokens: 2048

skills: []
tools: []

memory:
  persistHistory: false
  maxHistoryTurns: 10
  scopes:
    - scope: agent-local
      access: read-write

maxConcurrency: 1
turnTimeoutMs: 60000
```

### 定义工作流

创建 `workflows/code-review.workflow.yaml`:

```yaml
id: code-review
name: Code Review Pipeline
version: "1.0.0"
mode: dag

agents:
  analyzer:
    ref: ./agents/analyzer.agent.yaml
  reviewer:
    ref: ./agents/reviewer.agent.yaml
  summarizer:
    ref: ./agents/summarizer.agent.yaml

dag:
  nodes:
    - id: analyze
      agentId: analyzer
      type: task
      inputMapping:
        code: "$.input.code"
      retry:
        maxRetries: 2
        retryDelayMs: 1000
    
    - id: review
      agentId: reviewer
      type: task
      inputMapping:
        analysis: "$.nodes.analyze.output"
    
    - id: summarize
      agentId: summarizer
      type: task
      inputMapping:
        review: "$.nodes.review.output"
  
  edges:
    - from: analyze
      to: review
    - from: review
      to: summarize

sharedMemory:
  kvStore: sqlite
  persistent: true

schedule:
  maxDurationMs: 300000
```

### 运行工作流

```bash
# 使用 CLI
matrix workflow run code-review --input input.json

# 或使用 JavaScript API
import { Runtime } from '@thematrix/core';
import { loadWorkflowDefinition, loadAgentDefinition } from '@thematrix/config';

const runtime = new Runtime({
  dbPath: './data/matrix.db',
  globalTimeoutMs: 300000,
  maxConcurrentWorkflows: 10,
});

await runtime.start();

const definition = await loadWorkflowDefinition('./workflows/code-review.workflow.yaml');
const run = await runtime.runWorkflow(definition, { code: 'function add(a, b) { return a + b; }' });

console.log('Workflow run:', run.runId);

// 获取状态
const status = runtime.getStatus();
const health = await runtime.getHealth();
const metrics = runtime.getMetrics();

await runtime.stop();
```

## 📦 项目结构

```
thematrix/
├── packages/
│   ├── types/          # TypeScript 类型定义
│   ├── utils/          # 工具函数 (ID生成、日志、重试)
│   ├── config/         # 配置解析和验证 (YAML, Zod)
│   ├── core/           # 核心引擎
│   │   ├── agent/      # Agent 运行时
│   │   ├── workflow/   # 工作流引擎
│   │   ├── event/      # 事件总线和存储
│   │   ├── memory/     # 内存管理 (KV, 向量, 对话历史)
│   │   ├── messaging/  # 消息代理
│   │   ├── error/      # 错误处理
│   │   ├── health/     # 健康检查
│   │   └── metrics/    # 指标收集
│   └── adapters/       # LLM 适配器
│       └── llm/        # Claude, GPT, Mock
├── apps/
│   └── cli/            # 命令行工具
├── examples/           # 示例工作流
└── docs/               # 文档
```

## ⚙️ 配置

### 配置文件 (matrix.yaml)

```yaml
env: production

logging:
  level: info
  format: json
  output: both
  file: ./logs/matrix.log

database:
  path: ./data/matrix.db
  backupInterval: 86400000
  maxSizeMB: 1024

workflow:
  globalTimeoutMs: 300000
  maxConcurrent: 10
  defaultRetryCount: 2
  defaultRetryDelayMs: 1000

llm:
  providers:
    anthropic:
      apiKey: ${ANTHROPIC_API_KEY}
      defaultModel: claude-3-sonnet-20240229
      timeoutMs: 30000
    openai:
      apiKey: ${OPENAI_API_KEY}
      defaultModel: gpt-4
      timeoutMs: 30000

security:
  enableApiKey: true
  apiKeys:
    - ${MATRIX_API_KEY}

monitoring:
  enabled: true
  enablePrometheus: true
  prometheusPort: 9090
```

### 环境变量

```bash
# 基础配置
MATRIX_ENV=production
MATRIX_LOG_LEVEL=info
MATRIX_DB_PATH=./data/matrix.db

# LLM API Keys
ANTHROPIC_API_KEY=sk-...
OPENAI_API_KEY=sk-...

# 安全
MATRIX_API_KEY=your-secret-key
```

## 📊 监控和指标

### Prometheus 指标

TheMatrix 内置 Prometheus 格式的指标：

```
# 工作流指标
thematrix_workflow_runs_total{workflow_id="code-review"} 42
thematrix_workflow_runs_active 5
thematrix_workflow_run_duration_seconds_bucket{status="completed",le="10"} 38

# Agent 指标
thematrix_agent_runs_total{agent_id="analyzer"} 50
thematrix_agent_tokens_used_total{agent_id="analyzer"} 15000
thematrix_agent_errors_total{agent_id="analyzer"} 2

# LLM 指标
thematrix_llm_requests_total{provider="anthropic"} 100
thematrix_llm_request_duration_seconds_bucket{provider="anthropic",le="1"} 85
```

### 健康检查

```bash
# 获取健康状态
curl http://localhost:3000/health

{
  "status": "healthy",
  "checks": [
    {
      "name": "memory",
      "status": "healthy",
      "responseTimeMs": 5
    },
    {
      "name": "disk",
      "status": "healthy",
      "responseTimeMs": 2
    }
  ],
  "uptimeSeconds": 3600,
  "version": "0.1.0"
}
```

## 🧪 测试

```bash
# 运行所有测试
pnpm test

# 运行特定包测试
pnpm --filter @thematrix/core test

# 带覆盖率
pnpm test -- --coverage
```

## 🛠️ CLI 命令

```bash
# 项目管理
matrix init <name>                    # 初始化新项目
matrix init --template <name>         # 使用模板

# Agent 管理
matrix agent create <name>            # 创建 Agent
matrix agent list                     # 列出所有 Agent
matrix agent show <id>                # 查看 Agent 详情
matrix agent validate <file>          # 验证配置
matrix agent test <id>                # 测试 Agent

# 工作流管理
matrix workflow create <name>         # 创建工作流
matrix workflow list                  # 列出工作流
matrix workflow show <id>             # 查看详情
matrix workflow validate <file>       # 验证配置
matrix workflow run <id>              # 运行工作流
matrix workflow status <runId>        # 查看状态
matrix workflow pause <runId>         # 暂停
matrix workflow resume <runId>        # 恢复
matrix workflow cancel <runId>        # 取消

# 开发
matrix dev                            # 启动开发模式

# 系统
matrix config show                    # 显示配置
matrix health                         # 健康检查
matrix metrics                        # 查看指标
```

## 📝 示例

### 简单代码审查

```bash
cd examples/simple-pipeline
matrix workflow run code-review --input input.json
```

### 多 Agent 对话

```bash
cd examples/multi-agent-chat
matrix workflow run debate --input topic.json
```

## 🤝 贡献

欢迎贡献！请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 了解如何参与。

## 📄 许可证

[MIT](LICENSE)

## 🙏 致谢

- 灵感来自 [Claude Agent SDK](https://github.com/anthropics/anthropic-quickstarts)
- 架构设计参考 [Temporal](https://temporal.io/) 和 [Cadence](https://cadenceworkflow.io/)

---

<p align="center">Built with ❤️ by TheNeoAI Team</p>
