# TheMatrix

> Production-grade Multi-Agent Cluster Orchestration System

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22+-green.svg)](https://nodejs.org/)

TheMatrix is a production-grade system for building, running, and managing multi-agent AI workflows at scale. It provides a complete platform for orchestrating LLM-powered agents across distributed compute clusters, with built-in webhook integration, token budget management, real-time monitoring, and a web dashboard.

## Key Features

- **14+ LLM Providers** — OpenAI, Anthropic, Gemini, DeepSeek, Ollama, vLLM, OpenRouter, Moonshot, MiniMax, Qwen, HuggingFace, Azure OpenAI, OpenCode, KimiCode
- **Multi-Agent Workflows** — DAG, state-machine, and dynamic execution modes with shared memory
- **Autonomous Agent Loop** — Three modes: single-turn, autonomous loop, plan-and-execute with reflection
- **Agent Handoff** — Dynamic runtime delegation between agents with configurable targets
- **Input/Output Guardrails** — Content safety, PII detection, prompt injection, custom LLM-based checks
- **Human-in-the-Loop** — Approval gates in DAG workflows with timeout, auto-approve, and webhook callbacks
- **MCP Protocol** — Client and server for tool interoperability (JSON-RPC over stdio + HTTP)
- **Evaluation Framework** — 5 metric types: exact-match, contains, JSON validity, LLM-judge, semantic similarity
- **Distributed Execution** — Local, Docker, SSH (remote PC), and Kubernetes backends
- **Webhook Gateway** — Gerrit, Jira, GitLab, Feishu, WeChat, DingTalk, Slack, custom IM
- **Token Resource Pool** — Budget allocation, per-agent/workflow limits, rate limiting, cost tracking
- **Cluster Management** — Multi-node task distribution with 4 scheduling strategies
- **Real-time Monitoring** — REST API + SSE streaming + Prometheus metrics + alert rules
- **Web Dashboard** — Next.js dark-themed UI with Cmd+K command palette
- **Event Sourcing** — All state changes persisted as events for audit and replay

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        External Platforms                        │
│  Gerrit · Jira · GitLab · Feishu · WeChat · DingTalk · Slack   │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Webhooks
                  ┌────────▼────────┐
                  │    Gateway      │ :3002  @thematrix/gateway
                  │ Channel Adapters│
                  └────────┬────────┘
                           │ TriggerEvents
                  ┌────────▼────────┐
                  │   Scheduler     │        @thematrix/scheduler
                  │ Cron + Triggers │
                  └────────┬────────┘
                           │ Workflow Trigger
         ┌─────────────────▼─────────────────┐
         │           Core Engine              │  @thematrix/core
         │  Workflow Engine · Agent Runtime   │
         │  Event Bus · Memory Manager       │
         └─────────┬───────────┬─────────────┘
                   │           │
     ┌─────────────▼──┐  ┌────▼──────────────┐
     │   Providers     │  │    Executor       │  @thematrix/executor
     │ 14+ LLM APIs   │  │ Local·Docker·SSH  │
     │ Token Pool      │  │ Kubernetes        │
     │ Router+Failover │  └────┬──────────────┘
     └────────────────┘       │
                    ┌─────────▼──────────┐
                    │   Cluster Manager  │  @thematrix/cluster
                    │ Node Registry      │
                    │ 4 Strategies       │
                    │ Health Monitor     │
                    └────────────────────┘
         ┌───────────────────────────────────┐
         │          Monitor Server           │  :3001  @thematrix/monitor
         │  REST API · SSE · Alerts · Metrics│
         └──────────────┬────────────────────┘
                        │
               ┌────────▼────────┐
               │    Dashboard    │  :3000  apps/dashboard
               │   Next.js 15   │
               └─────────────────┘
```

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/theneoai/thematrix.git
cd thematrix && pnpm install

# 2. Configure providers
cp matrix.config.yaml my-config.yaml
# Edit my-config.yaml with your API keys

# 3. Build and run
pnpm build
node apps/cli/dist/index.js server start
```

**Docker:**
```bash
docker compose up -d
```

## Package Overview

| Package | Description | Layer |
|---------|-------------|-------|
| `@thematrix/types` | TypeScript type definitions for all domains | Foundation |
| `@thematrix/utils` | Shared utilities (logger, ID generator, retry) | Foundation |
| `@thematrix/config` | Zod schema validation + YAML config loading | Foundation |
| `@thematrix/adapters` | LLM adapter implementations (Anthropic, OpenAI, etc.) | Core |
| `@thematrix/core` | Agent runtime, workflow engine, guardrails, memory, events, policy | Core |
| `@thematrix/mcp` | MCP client/server + agent & workflow tool definitions | Core |
| `@thematrix/eval` | Evaluation framework with 5 metric types | Core |
| `@thematrix/providers` | Provider plugin system, token pool, router, secrets | Infrastructure |
| `@thematrix/executor` | Execution backends (Local/Docker/SSH/K8s) | Infrastructure |
| `@thematrix/gateway` | Webhook server + 8 platform adapters | Orchestration |
| `@thematrix/scheduler` | Cron scheduling + event-driven triggers | Orchestration |
| `@thematrix/monitor` | REST API + SSE + alerts + Prometheus metrics | Orchestration |
| `@thematrix/cluster` | Multi-node management + distribution strategies | Infrastructure |
| `apps/dashboard` | Next.js 15 web dashboard with dark theme + Cmd+K | App |
| `apps/cli` | Command-line interface (Commander.js) | App |

## Supported Providers

| Provider | Type | Models |
|----------|------|--------|
| OpenAI | Cloud | GPT-4o, GPT-4o Mini, o3-mini |
| Anthropic | Cloud | Claude Opus 4, Sonnet 4, Haiku 4.5 |
| Google Gemini | Cloud | Gemini 2.5 Pro, 2.0 Flash |
| DeepSeek | Cloud | DeepSeek Chat (V3), Reasoner (R1) |
| Moonshot (Kimi) | Cloud | Moonshot V1 8K/32K/128K |
| MiniMax | Cloud | ABAB 6.5s, 6.5g |
| Alibaba Qwen | Cloud | Qwen Max, Plus, Turbo, Coder Plus |
| HuggingFace | Cloud | Llama 3 8B + any HF model |
| Azure OpenAI | Cloud | GPT-4o, GPT-4o Mini |
| OpenRouter | Proxy | 200+ models from all providers |
| Ollama | Local | Llama 3, CodeLlama, Qwen 2.5 Coder |
| vLLM | Self-hosted | Any HF-compatible model |
| OpenCode | IDE | IDE-integrated coding assistant |
| KimiCode | IDE | Kimi coding assistant |

## Supported Integrations

| Platform | Direction | Use Case |
|----------|-----------|----------|
| Gerrit | In + Out | Code review on patchset creation |
| Jira | In + Out | Bug triage on issue creation |
| GitLab | In + Out | MR review on merge request |
| Feishu (Lark) | In + Out | IM commands, card notifications |
| WeChat Work | In + Out | Bot commands, markdown messages |
| DingTalk | In + Out | Robot callbacks, webhook notifications |
| Slack | In + Out | Events API, Block Kit messages |
| Custom | In + Out | Generic webhook with configurable parsing |

## Documentation

- [Technical Architecture](docs/architecture.md) — System design, data flows, component details
- [Product Design](docs/product-design.md) — Vision, use cases, feature matrix, roadmap
- [API Reference](docs/api-reference.md) — REST endpoints, SSE, webhook formats
- [Deployment Guide](docs/deployment-guide.md) — Docker, Kubernetes, configuration
- [Provider Guide](docs/provider-guide.md) — LLM provider setup, token budgets, routing
- [Integration Guide](docs/integration-guide.md) — Platform webhook setup, trigger rules

## License

[MIT](LICENSE)
