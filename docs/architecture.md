# TheMatrix - Technical Architecture

## Overview

TheMatrix is a multi-agent workflow orchestration system designed for AI-native DevOps automation. It provides a complete platform for defining, scheduling, executing, and monitoring AI agent workflows across distributed infrastructure.

The system is built as a TypeScript monorepo using pnpm workspaces and Turborepo, with a layered architecture that separates concerns across 13 packages and 2 applications.

---

## System Architecture

```
                    ┌─────────────────────────────────────────────┐
                    │               User Interfaces                │
                    │  ┌────────────┐  ┌──────────┐  ┌─────────┐  │
                    │  │  Dashboard  │  │   CLI    │  │   API   │  │
                    │  │ (Next.js)  │  │(Commander)│  │ (REST)  │  │
                    │  └─────┬──────┘  └────┬─────┘  └────┬────┘  │
                    └────────┼──────────────┼─────────────┼───────┘
                             │              │             │
                    ┌────────┴──────────────┴─────────────┴───────┐
                    │             Orchestration Layer               │
                    │  ┌───────────┐ ┌──────────┐ ┌────────────┐  │
                    │  │  Monitor   │ │ Gateway  │ │  Scheduler │  │
                    │  │(REST+SSE) │ │(Webhooks)│ │(Cron+Event)│  │
                    │  └─────┬─────┘ └────┬─────┘ └─────┬──────┘  │
                    │        │            │              │          │
                    │  ┌─────┴────────────┴──────────────┴──────┐  │
                    │  │              Core Engine                │  │
                    │  │  ┌──────────┐  ┌──────────────────┐    │  │
                    │  │  │ Workflow  │  │  Agent Runtime   │    │  │
                    │  │  │  Engine   │  │  (Lifecycle Mgr) │    │  │
                    │  │  └────┬─────┘  └───────┬──────────┘    │  │
                    │  │       │                │                │  │
                    │  │  ┌────┴────┐  ┌───────┴──────────┐     │  │
                    │  │  │EventBus │  │ Memory Manager   │     │  │
                    │  │  │& Store  │  │ (KV/Vector/Chat) │     │  │
                    │  │  └─────────┘  └──────────────────┘     │  │
                    │  └────────────────────────────────────────┘  │
                    └─────────────┬────────────────────────────────┘
                                  │
                    ┌─────────────┴────────────────────────────────┐
                    │             Infrastructure Layer              │
                    │  ┌──────────┐ ┌──────────┐ ┌─────────────┐  │
                    │  │Providers │ │ Executor │ │   Cluster   │  │
                    │  │(14 LLMs) │ │(4 Backs) │ │ (4 Strats)  │  │
                    │  └──────────┘ └──────────┘ └─────────────┘  │
                    └──────────────────────────────────────────────┘
                                  │
                    ┌─────────────┴────────────────────────────────┐
                    │              Foundation Layer                 │
                    │  ┌──────────┐ ┌──────────┐ ┌─────────────┐  │
                    │  │  Types   │ │  Config  │ │    Utils    │  │
                    │  │(Schemas) │ │(Zod+YAML)│ │(Log/ID/Retry│  │
                    │  └──────────┘ └──────────┘ └─────────────┘  │
                    └──────────────────────────────────────────────┘
```

---

## Tech Stack

| Category | Technology |
|----------|-----------|
| Language | TypeScript (strict mode, ESM) |
| Monorepo | pnpm workspaces + Turborepo |
| Build | tsup (ESM + DTS output) |
| Runtime | Node.js 22+ |
| CLI | Commander.js + Ink (React terminal UI) |
| Dashboard | Next.js 15 + React 19 + Tailwind CSS |
| State Management | Zustand + TanStack Query |
| Storage | In-memory (dev) + SQLite via better-sqlite3 |
| Config | YAML + Zod validation |
| Testing | Vitest |
| IDs | ULID |
| Metrics | Prometheus-compatible format |
| Real-time | Server-Sent Events (SSE) |

---

## Package Structure

```
thematrix/
├── packages/
│   ├── types/          @thematrix/types      Type definitions & interfaces
│   ├── utils/          @thematrix/utils      Logger, ID gen, retry, errors
│   ├── config/         @thematrix/config     YAML parsing + Zod schemas
│   ├── adapters/       @thematrix/adapters   LLM adapter implementations
│   ├── core/           @thematrix/core       Engine, runtime, memory, events
│   ├── providers/      @thematrix/providers  Provider plugins, token pool, router
│   ├── executor/       @thematrix/executor   Execution backends
│   ├── gateway/        @thematrix/gateway    Webhook server + channel adapters
│   ├── scheduler/      @thematrix/scheduler  Cron + event-driven triggers
│   ├── monitor/        @thematrix/monitor    REST API + SSE + alerts
│   ├── cluster/        @thematrix/cluster    Multi-node management
│   ├── mcp/            @thematrix/mcp        MCP server/client
│   └── plugins/        @thematrix/plugins    Plugin host & loader
│
├── apps/
│   ├── cli/            @thematrix/cli        CLI management tool
│   └── dashboard/      @thematrix/dashboard  Web UI (Next.js 15)
│
├── k8s/                Kubernetes manifests
├── Dockerfile          Multi-stage build
├── docker-compose.yml  Single-node deployment
├── docker-compose.cluster.yml  Multi-node cluster
└── matrix.config.yaml  Example configuration
```

### Dependency Graph

```
types ← utils ← config ← adapters ← core ← providers
                                       ↑        ↑
                                  executor   gateway
                                       ↑        ↑
                                   scheduler  monitor
                                       ↑
                                    cluster
                                       ↑
                                    cli/dashboard
```

---

## Subsystem Details

### 1. Provider System (@thematrix/providers)

The provider system abstracts LLM access through a plugin architecture supporting 14 providers.

**Components:**
- **ProviderRegistry** -- Plugin registration and lifecycle management
- **TokenPool** -- Budget allocation, rate limiting (RPM/TPM/concurrent), cost tracking
- **ProviderRouter** -- Request routing with 4 strategies (priority, round-robin, least-cost, failover)
- **SecretManager** -- Credential resolution from env vars, files, or vault with caching

**Supported Providers:**
OpenAI, Anthropic, Google Gemini, Azure OpenAI, AWS Bedrock, Mistral, Groq, Together, DeepSeek, OpenRouter, Ollama, OpenCode, KimiCode, MiniMax

**Plugin Interface:**
```typescript
interface ProviderPlugin {
  name: ProviderName;
  displayName: string;
  models: ModelCatalogEntry[];
  prepareRuntimeAuth(config: ProviderConfig): Promise<RuntimeAuth>;
  createAdapter(auth: RuntimeAuth, model: string): Promise<LLMAdapter>;
  healthCheck(config: ProviderConfig): Promise<boolean>;
}
```

### 2. Execution System (@thematrix/executor)

Four execution backends implement a common `ExecutionBackend` interface:

| Backend | Transport | Use Case |
|---------|-----------|----------|
| Local | In-process AgentRuntime | Development, testing |
| Docker | Docker Engine REST API | Isolated container execution |
| SSH | SSH + remote shell commands | Remote server execution |
| Kubernetes | K8s Jobs API | Production cluster execution |

The `ExecutorManager` routes tasks to the appropriate backend based on configuration.

### 3. Gateway System (@thematrix/gateway)

The gateway provides a Node.js HTTP server that receives webhooks from 8 platforms and normalizes them into `TriggerEvent` objects.

**Channel Adapters:**

| Platform | Signature Method | Event Types |
|----------|-----------------|-------------|
| Gerrit | HMAC-SHA256 | patchset-created, change-merged, comment-added |
| Jira | HMAC-SHA256 (x-hub-signature) | issue_created, issue_updated, comment_created |
| GitLab | Token (X-Gitlab-Token) | push, merge_request, note, pipeline |
| Feishu | HMAC-SHA256 (timestamp+nonce) | message, interactive |
| WeChat | SHA1 (token+timestamp+nonce) | text, event |
| DingTalk | HMAC-SHA256 (timestamp+secret) | text, interactive |
| Slack | HMAC-SHA256 (v0 signing) | message, app_mention |
| Custom | Configurable | Any |

All signature verifications use `timingSafeEqual` to prevent timing attacks.

### 4. Scheduler System (@thematrix/scheduler)

**CronScheduler:**
- Custom 5-field cron parser (minute, hour, day-of-month, month, day-of-week)
- Timezone support via `Intl.DateTimeFormat` (no external dependencies)
- Range, step, and list expressions

**TriggerMatcher:**
- 7 condition operators: `equals`, `not_equals`, `contains`, `matches`, `in`, `gt`, `lt`
- JSONPath field resolution for nested event data
- Cooldown and maxConcurrent enforcement

### 5. Monitoring System (@thematrix/monitor)

- **REST API** -- 16 routes covering workflows, agents, tokens, cluster, triggers, metrics, health, and alerts
- **SSE Manager** -- Real-time event streaming to dashboard clients with type-based filtering
- **AlertManager** -- Threshold-based rules with severity levels, duration tracking, and cooldown
- **HealthAggregator** -- Collects health checks from all subsystems

### 6. Cluster System (@thematrix/cluster)

- **NodeRegistry** -- Node registration with heartbeat tracking
- **WorkDistributor** -- Task distribution with 30s timeout on HTTP submissions
- **ClusterHealthMonitor** -- Periodic health checks of all registered nodes

**Distribution Strategies:**

| Strategy | Description |
|----------|-------------|
| round-robin | Cyclic distribution across healthy nodes |
| least-loaded | Routes to node with lowest current load |
| resource-aware | Considers CPU, memory, GPU availability |
| label-match | Matches task labels against node capabilities |

---

## Event System

The event bus implements an event sourcing pattern with 30+ event types organized by subsystem:

```
WORKFLOW_*    -- Workflow lifecycle (started, completed, failed, cancelled)
AGENT_*       -- Agent lifecycle (started, completed, error, message)
NODE_*        -- DAG node execution (started, completed, failed, skipped)
TRIGGER_*     -- Webhook triggers (received, matched, fired)
TOKEN_*       -- Token budget (consumed, warning, exceeded)
CLUSTER_*     -- Cluster management (registered, deregistered, offline)
EXECUTION_*   -- Backend execution (started, completed, failed)
ALERT_*       -- Alert lifecycle (fired, resolved, acknowledged)
SCHEDULE_*    -- Cron scheduling (fired)
```

Events are stored in SQLite for replay and audit, and broadcast to SSE clients for real-time monitoring.

---

## Configuration

All configuration is defined in `matrix.config.yaml` and validated with Zod schemas:

```yaml
providers:
  - name: openai
    credentials: { type: env, ref: OPENAI_API_KEY }
    models: [gpt-4o, gpt-4o-mini]

tokenPool:
  globalBudget: { maxTokens: 10000000, maxCostUsd: 100, period: monthly }
  perAgent: { maxTokens: 500000, maxCostUsd: 10 }

execution:
  backend: docker
  parallelism: 4

gateway:
  port: 9090
  channels:
    - platform: gitlab
      secret: { type: env, ref: GITLAB_WEBHOOK_TOKEN }

monitor:
  port: 8080
  enableSSE: true
  alerts:
    - name: high-error-rate
      metric: workflow.error_rate
      condition: { operator: gt, threshold: 0.1, durationMs: 60000 }
      severity: critical

cluster:
  strategy: least-loaded
  heartbeatIntervalMs: 30000
```

---

## Design Patterns

| Pattern | Usage |
|---------|-------|
| Event Sourcing | All state changes emitted as DomainEvents, stored for replay |
| Plugin/Adapter | Provider plugins, channel adapters, execution backends |
| Registry | Central registries for providers, agents, workflows, nodes |
| Strategy | Routing strategies, distribution strategies, execution modes |
| Observer | SSE streaming, event bus subscriptions |
| Factory | `createOpenAICompatiblePlugin` for provider creation |
| Mediator | EventBus + SchedulerManager decouple subsystem communication |

---

## Security Measures

- **Signature Verification** -- All webhook adapters use HMAC with `timingSafeEqual`
- **Secret Management** -- Credentials resolved via env vars, files, or vault (never stored in config)
- **Input Sanitization** -- SSH commands sanitized, prototype pollution guards on JSON paths
- **Rate Limiting** -- Per-provider RPM/TPM/concurrent limits enforced by TokenPool
- **Body Size Limits** -- Gateway enforces 10MB max request body
- **ReDoS Protection** -- Trigger regex matching limited to 10K character inputs
- **Timeout Guards** -- All external HTTP calls have abort timeouts

---

## Deployment Options

1. **Local Development** -- `pnpm dev` starts all packages in watch mode
2. **Docker Single Node** -- `docker-compose up` runs matrix-server with optional Ollama
3. **Docker Cluster** -- `docker-compose.cluster.yml` runs control + worker nodes
4. **Kubernetes** -- Full manifests in `k8s/` with RBAC, ConfigMap, PVC, Services

---

## Build & Test

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages (turborepo, dependency-ordered)
pnpm test             # Run all tests (vitest)
pnpm typecheck        # TypeScript type checking
pnpm lint             # ESLint
```
