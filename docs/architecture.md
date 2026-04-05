# TheMatrix - Technical Architecture

## Overview

TheMatrix is a multi-agent workflow orchestration system designed for AI-native DevOps automation. It provides a complete platform for defining, scheduling, executing, and monitoring AI agent workflows across distributed infrastructure.

The system is built as a TypeScript monorepo using pnpm workspaces and Turborepo, with a layered architecture that separates concerns across 14 packages and 2 applications.

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
│   ├── mcp/            @thematrix/mcp        MCP server/client + tool definitions
│   └── eval/           @thematrix/eval       Evaluation framework & metrics
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

                          core ← mcp     (MCP server/client)
                          core ← eval    (Evaluation framework)
```

---

## Core Engine Subsystems (@thematrix/core)

The core engine contains the primary runtime components that power agent execution and workflow orchestration.

### Agent Runtime

The agent runtime manages the full lifecycle of an individual agent execution, from initialization through tool-use loops to final output.

**Components:**

| Component | File | Purpose |
|-----------|------|---------|
| **AgentRuntime** | `agent/runtime.ts` | Core execution: LLM calls, tool invocation, memory, guardrails |
| **AgentLoop** | `agent/loop.ts` | Autonomous multi-turn orchestration (3 execution modes) |
| **AgentPlanner** | `agent/planner.ts` | LLM-based task decomposition into step plans |
| **AgentReflector** | `agent/reflection.ts` | Self-evaluation with quality scoring and retry decisions |
| **HandoffManager** | `agent/handoff.ts` | Dynamic agent-to-agent delegation at runtime |
| **AgentRegistry** | `agent/registry.ts` | Agent definition registration and lookup |

**Execution Modes (AgentLoop):**

| Mode | Description |
|------|-------------|
| `single-turn` | One LLM call, backward-compatible with basic agents |
| `loop` | Autonomous iteration until `[DONE]` signal, exit condition, or token budget exhausted |
| `plan-and-execute` | LLM generates a plan, executes steps sequentially, reflects after each step, optionally revises plan (up to 3 revisions) |

**Agent Turn Lifecycle:**
1. Input guardrails (content safety, PII detection, prompt injection, custom LLM-based)
2. Append user message to conversation history
3. LLM call with retry and timeout
4. Tool-use loop (max 20 iterations): execute tools → feed results back to LLM → repeat
5. Structured output validation with one retry on schema mismatch
6. Output guardrails
7. Append assistant response to history

**Error Recovery:**
- Loop mode tracks consecutive errors (max 3), resets agent from error state, and feeds error context as retry input
- Plan-and-execute skips steps with failed dependencies, supports plan revision on reflection feedback

### Workflow Engine

The workflow engine orchestrates multi-agent execution across three workflow modes.

**Workflow Modes:**

| Mode | Backing Structure | Use Case |
|------|-------------------|----------|
| `dag` | Directed Acyclic Graph | Parallel agent pipelines with dependencies |
| `state-machine` | FSM with named states | Sequential flows with branching logic |
| `dynamic` | Runtime agent spawning | Flexible orchestration via message broker |

**DAG Execution Features:**
- Parallel execution of independent branches
- Dependency validation (circular dependency detection, edge validation)
- Atomic node claiming to prevent race conditions in parallel execution
- Per-node retry with error classification (retryable vs non-retryable)
- Failed dependency propagation (skips downstream nodes)

**State Machine Features:**
- State types: `task` (agent execution), `choice` (conditional branching), `wait` (timed delay), `succeed`/`fail` (terminal)
- Condition evaluation with path resolution (`$.input.*`, `$.nodes.*`)
- Infinite loop detection (max steps = state count × 10)

**Human-in-the-Loop (Approval Gates):**
- DAG nodes can be typed as `approval` to pause workflow for human decision
- `ApprovalManager` handles request/approve/reject/timeout lifecycle
- Configurable timeout with auto-approve or auto-reject action
- HTTP callback notification when approval is requested
- Event-driven: publishes `APPROVAL_REQUESTED`, `APPROVED`, `REJECTED`, `TIMED_OUT`

**Workflow Lifecycle:**
- Concurrent workflow limit (default 10)
- Global timeout per workflow (default 5 minutes)
- Pause/resume/cancel support
- Cleanup with 1-hour retention for status queries

### Memory System

| Component | File | Purpose |
|-----------|------|---------|
| **MemoryManager** | `memory/manager.ts` | KV storage + conversation history (SQLite-backed) |
| **InMemoryVectorStore** | `memory/vector-store.ts` | In-memory vector store with cosine similarity search |
| **SemanticMemory** | `memory/semantic.ts` | High-level semantic memory (embed + store + retrieve) |
| **LLMEmbeddingProvider** | `memory/embeddings.ts` | Hash-based dev embeddings + OpenAI-compatible API provider |

**Features:**
- Key-value storage with optional TTL expiration
- Conversation history (user/assistant/tool turns) with tool call tracking
- Vector search with metadata filtering (exact match and array-based `in` filters)
- Batch embedding with sequential index validation
- Iterative batch storage (100 docs per batch) to prevent API overload

### Guardrail System

| Component | File | Purpose |
|-----------|------|---------|
| **GuardrailRunner** | `guardrails/index.ts` | Orchestrates input/output guardrail evaluation |
| **OutputValidator** | `guardrails/validators.ts` | JSON schema validation with recursion depth limits |

**Built-in Guardrails:**

| Type | Detection Method | Severity |
|------|-----------------|----------|
| `content-safety` | Regex patterns for harmful content | critical |
| `pii-detection` | Regex for email, phone, SSN, credit card | medium-high |
| `prompt-injection` | Regex for injection patterns ("ignore previous", "DAN mode", etc.) | critical |
| `schema-validation` | JSON schema validation against config schema | high |

**Custom Guardrails:**
- LLM-based evaluation using configurable prompt + model
- Three actions: `block` (stop execution), `warn` (log and continue), `rewrite` (LLM rewrites content)
- Applies to `input`, `output`, or `both` directions
- Fails open on evaluation errors to avoid blocking legitimate content

### Policy Engine

| Component | File | Purpose |
|-----------|------|---------|
| **PolicyEngine** | `policy/index.ts` | Rule-based evaluation with expression language |

**Expression Operators:**
- Equality: `field == "value"`, `field != "value"`
- Comparison: `field > 100`, `field < 50`
- Pattern: `field matches "regex"` (max 200 char pattern, 10K char input)
- Containment: `field contains "substring"`
- Boolean: `&&` and `||` combinators

**Enforcement Modes:** `enforce` (block on violation), `warn` (log only), `audit` (record for review)

### Environment Manager

Resolves per-environment configuration overrides (development, staging, production, custom). Supports:
- Provider config overrides per environment
- Execution backend selection per environment
- Environment-specific variables
- Runtime environment switching
- Constructor validation that active environment exists

### Event System

- **EventBus** (`event/bus.ts`) — Async pub/sub with topic-based subscriptions
- **EventStore** (`event/store.ts`) — SQLite-backed event persistence for replay/audit
- 30+ event types across 9 subsystems (see Event System section below)

### Error Handling

- **WorkflowError** — Workflow-specific errors with runId context
- **ResourceNotFoundError** — Missing agent/workflow/node errors
- **classifyError()** — Categorizes errors as retryable vs non-retryable with backoff hints

### Metrics

Prometheus-compatible metric collection:
- `workflow_runs_total` — Counter by workflow_id
- `workflow_runs_active` — Gauge of concurrent workflows
- `workflow_run_duration_seconds` — Histogram by workflow_id and status
- `workflow_node_duration_seconds` — Histogram by workflow_id, node_id, agent_id
- `agent_errors_total` — Counter by workflow_id and node_id
- `events_published_total` — Counter by event_type

---

## MCP Integration (@thematrix/mcp)

The Model Context Protocol integration enables interoperability with external tool servers and exposes TheMatrix capabilities as MCP tools.

**Components:**

| Component | File | Purpose |
|-----------|------|---------|
| **MCPClient** | `client.ts` | Connects to external MCP servers (stdio + HTTP transport) |
| **MCPServer** | `server.ts` | Exposes TheMatrix tools via JSON-RPC over stdio |
| **AgentTools** | `agent-tools.ts` | MCP tool definitions for agent operations |
| **WorkflowTools** | `workflow-tools.ts` | MCP tool definitions for workflow operations |

**Client Features:**
- Dual transport: stdio (child process) and HTTP (REST)
- JSON-RPC 2.0 protocol with request ID wraparound at 2³¹
- 30-second request timeout on both transports
- Automatic pending request rejection on disconnect
- Stderr logging for child process output

**Server Features:**
- Dynamic tool registration/unregistration
- JSON-RPC 2.0 over stdio with initialization handshake
- Parameter validation (tool name, argument type checking)
- Graceful error handling (tool errors returned as `isError: true`)

---

## Evaluation Framework (@thematrix/eval)

The evaluation framework provides systematic testing of agent quality.

**Components:**

| Component | File | Purpose |
|-----------|------|---------|
| **EvalRunner** | `runner.ts` | Concurrent eval suite execution with semaphore-based concurrency |
| **Metrics** | `metrics.ts` | 5 built-in metric types |
| **Reporter** | `reporter.ts` | Results formatting and output |
| **SuiteLoader** | `suite-loader.ts` | YAML eval suite loading |

**Built-in Metrics:**

| Metric | Type | Description |
|--------|------|-------------|
| `exact-match` | String | score=1 if output === expected |
| `contains` | String | score=1 if output contains expected |
| `json-validity` | Schema | score=1 if output is valid JSON (optional key check) |
| `llm-judge` | LLM | LLM evaluates output quality (0-10 normalized to 0-1) |
| `semantic-similarity` | Embedding | Cosine similarity between output and expected embeddings |

**Execution Features:**
- Configurable concurrency with queue-based semaphore
- Per-case timeout
- Result ordering preserved in concurrent execution
- Fresh agent runtime per eval case

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
