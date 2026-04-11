# TheMatrix - Technical Architecture

> 文档版本: 3.0 | 更新时间: 2026-04-11 | 基于 Q2 全量代码审查 + 最新行业趋势

---

## Overview

TheMatrix is a **production-grade Multi-Agent Cluster Orchestration System** and **Agent Governance Platform**, designed for AI-native DevOps automation at enterprise scale. It provides a complete infrastructure layer for defining, scheduling, executing, monitoring, and governing AI agent workflows across distributed infrastructure.

**核心定位演进：**

```
第 1 代 (2025 以前):   Agent 编排框架        [DAG/状态机 + LLM 调用]
第 2 代 (2025-2026 Q1): Agent 编排基础设施   [+ 集群执行 + 成本治理 + webhook]
第 3 代 (2026 Q2 起):  Agent 治理平台        [+ 协议生态 + 合规审计 + 风险管理]
```

**Mission:** Make multi-agent AI workflows as manageable, observable, and reliable as traditional CI/CD pipelines.

The system is built as a TypeScript monorepo (~26,600 lines, 140 source files) using pnpm workspaces and Turborepo, with a layered architecture across 13 packages and 2 applications.

---

## System Architecture

```
                    ┌─────────────────────────────────────────────┐
                    │               User Interfaces                │
                    │  ┌────────────┐  ┌──────────┐  ┌─────────┐  │
                    │  │  Dashboard  │  │   CLI    │  │   API   │  │
                    │  │ (Next.js15)│  │(Commander)│  │(REST+SSE│  │
                    │  └─────┬──────┘  └────┬─────┘  └────┬────┘  │
                    └────────┼──────────────┼─────────────┼───────┘
                             │              │             │
                    ┌────────┴──────────────┴─────────────┴───────┐
                    │             Orchestration Layer               │
                    │  ┌───────────┐ ┌──────────┐ ┌────────────┐  │
                    │  │  Monitor  │ │ Gateway  │ │  Scheduler │  │
                    │  │(REST+SSE) │ │(8 Platf.)│ │(Cron+Event)│  │
                    │  └─────┬─────┘ └────┬─────┘ └─────┬──────┘  │
                    │        │            │              │          │
                    │  ┌─────┴────────────┴──────────────┴──────┐  │
                    │  │              Core Engine                │  │
                    │  │  ┌──────────┐  ┌──────────────────┐    │  │
                    │  │  │ Workflow  │  │  Agent Runtime   │    │  │
                    │  │  │  Engine  │  │  (+ Mutex Guard) │    │  │
                    │  │  │DAG/SM/Dyn│  └───────┬──────────┘    │  │
                    │  │  │/Cognitive│           │               │  │
                    │  │  └────┬─────┘  ┌───────┴──────────┐    │  │
                    │  │       │        │  Memory Manager  │    │  │
                    │  │  ┌────┴────┐   │ KV/Vector/Chat/  │    │  │
                    │  │  │ Check-  │   │ Cognitive(3-tier) │   │  │
                    │  │  │ point   │   └──────────────────┘    │  │
                    │  │  │ Store   │  ┌──────────────────┐     │  │
                    │  │  └─────────┘  │   Guardrails +   │     │  │
                    │  │  ┌─────────┐  │  Policy Engine   │     │  │
                    │  │  │Self-    │  └──────────────────┘     │  │
                    │  │  │Healing  │  ┌──────────────────┐     │  │
                    │  │  │Strategy │  │  EventBus/Store  │     │  │
                    │  │  └─────────┘  │  (SQLite-backed) │     │  │
                    │  │               └──────────────────┘     │  │
                    │  └────────────────────────────────────────┘  │
                    └─────────────┬────────────────────────────────┘
                                  │
                    ┌─────────────┴────────────────────────────────┐
                    │             Infrastructure Layer              │
                    │  ┌──────────┐ ┌──────────┐ ┌─────────────┐  │
                    │  │Providers │ │ Executor │ │   Cluster   │  │
                    │  │(14 LLMs) │ │(4 Backs) │ │(4 Strats)   │  │
                    │  │5 Routing │ │Local/    │ │RR/Loaded/   │  │
                    │  │Strategies│ │Docker/   │ │Resource/    │  │
                    │  │          │ │SSH/K8s   │ │LabelMatch   │  │
                    │  └──────────┘ └──────────┘ └─────────────┘  │
                    └──────────────────────────────────────────────┘
                                  │
                    ┌─────────────┴────────────────────────────────┐
                    │              Foundation Layer                 │
                    │  ┌──────────┐ ┌──────────┐ ┌─────────────┐  │
                    │  │  Types   │ │  Config  │ │    Utils    │  │
                    │  │(280+ defs│ │(Zod+YAML)│ │(Log/ID/Retry│  │
                    │  └──────────┘ └──────────┘ └─────────────┘  │
                    └──────────────────────────────────────────────┘
```

---

## Tech Stack

| Category | Technology | Notes |
|----------|-----------|-------|
| Language | TypeScript 5.7+ (strict, ESM) | 140 source files, ~26,600 lines |
| Monorepo | pnpm 9.0.0 + Turborepo 2.3.0 | Workspace-based, dependency-ordered builds |
| Build | tsup 8.0.0 (ESM + DTS) | All packages publish dual format |
| Runtime | Node.js 22+ (20+ supported) | ESM-first |
| CLI | Commander.js 13.0 + chalk + ora | Terminal UI |
| Dashboard | Next.js 15 + React 19 + Tailwind CSS 3.4 | Dark theme, Cmd+K palette |
| State | Zustand 5.0 + TanStack Query 5.62 | Client state & caching |
| Visualization | ReactFlow 11.11 + Recharts 2.15 | DAG & metrics display |
| Storage | SQLite 3 (better-sqlite3 12.1) | Events, memory, checkpoint, config |
| Config | YAML + Zod validation | Type-safe configuration |
| Testing | Vitest 2.1.0 | 124 tests across 5 packages |
| IDs | ULID (ulidx 2.4) | Sortable unique identifiers |
| Real-time | Server-Sent Events (SSE) | Dashboard live updates |
| Metrics | Prometheus-compatible format | Compatible with Prometheus/Grafana |

---

## Package Structure

```
thematrix/
├── packages/
│   ├── types/      @thematrix/types      280+ TypeScript type definitions
│   ├── utils/      @thematrix/utils      Logger, ULID, retry, MatrixError hierarchy
│   ├── config/     @thematrix/config     YAML parsing + Zod validation schemas
│   ├── adapters/   @thematrix/adapters   14 LLM adapter implementations
│   ├── core/       @thematrix/core       Engine, runtime, memory, events, guardrails
│   ├── providers/  @thematrix/providers  Provider plugins, token pool, 5-strategy router
│   ├── executor/   @thematrix/executor   4 execution backends
│   ├── gateway/    @thematrix/gateway    Webhook server + 8 channel adapters
│   ├── scheduler/  @thematrix/scheduler  Cron + event-driven triggers
│   ├── monitor/    @thematrix/monitor    REST API (16 routes) + SSE + alerts
│   ├── cluster/    @thematrix/cluster    Multi-node management + draining
│   ├── mcp/        @thematrix/mcp        MCP server/client + A2A bridge
│   └── eval/       @thematrix/eval       Evaluation framework (5 metric types)
│
├── apps/
│   ├── cli/        @thematrix/cli        CLI management tool
│   └── dashboard/  @thematrix/dashboard  Next.js 15 web UI
│
├── k8s/            Kubernetes manifests (6 files)
├── examples/       Example workflows and agent definitions
├── Dockerfile      Multi-stage build (Alpine)
├── docker-compose.yml              Single-node deployment
├── docker-compose.cluster.yml      Multi-node cluster
└── matrix.config.yaml              Example configuration
```

### Package Dependency Graph

```
types ← utils ← config ← adapters ← core ← providers
                                      ↑         ↑
                                  executor    gateway
                                      ↑         ↑
                                  scheduler   monitor
                                      ↑
                                   cluster
                                      ↑
                               cli / dashboard

                    core ← mcp     (MCP + A2A bridge)
                    core ← eval    (Evaluation framework)
```

---

## Core Engine Subsystems (@thematrix/core)

The core engine is the central runtime containing agent execution, workflow orchestration, memory, guardrails, events, and all Q2 new capabilities.

### Agent Runtime (`agent/`)

Manages the full lifecycle of an individual agent, from initialization through tool-use loops to final output.

| Component | File | Purpose |
|-----------|------|---------|
| **AgentRuntime** | `agent/runtime.ts` | LLM calls, tool invocation, memory, guardrails, mutex guard |
| **AgentLoop** | `agent/loop.ts` | Autonomous multi-turn orchestration (3 execution modes) |
| **AgentPlanner** | `agent/planner.ts` | LLM-based task decomposition into step plans |
| **AgentReflector** | `agent/reflection.ts` | Self-evaluation with quality scoring and retry decisions |
| **HandoffManager** | `agent/handoff.ts` | Dynamic agent-to-agent delegation at runtime |
| **AgentRegistry** | `agent/registry.ts` | Agent definition registration and lookup |

**Execution Modes (AgentLoop):**

| Mode | Description |
|------|-------------|
| `single-turn` | One LLM call, backward-compatible |
| `loop` | Autonomous iteration until `[DONE]` signal, exit condition, or token budget exhausted |
| `plan-and-execute` | LLM generates plan → executes steps → reflects after each → revises plan (≤3 revisions) |

**Agent Turn Lifecycle:**
1. Mutex lock (prevents concurrent `runTurn()` on same instance)
2. Input guardrails (content-safety, PII, prompt-injection, custom LLM-based)
3. Append user message to conversation history + proactive memory recall injection
4. LLM call with retry and timeout
5. Tool-use loop (max 20 iterations): execute tools → feed results → repeat
6. Structured output validation with one retry on schema mismatch
7. Output guardrails (rewrite depth limited to 3 to prevent infinite recursion)
8. Append assistant response to history

**Error Recovery:**
- Loop mode tracks consecutive errors (max 3), resets agent state, feeds error context as retry input
- Plan-and-execute skips steps with failed dependencies, supports plan revision on reflection feedback

---

### Workflow Engine (`workflow/`)

Orchestrates multi-agent execution across four workflow modes.

| Mode | Backing Structure | Use Case |
|------|-------------------|----------|
| `dag` | Directed Acyclic Graph | Parallel pipelines with dependencies |
| `state-machine` | FSM with named states | Sequential flows with conditional branching |
| `dynamic` | Runtime agent spawning | Flexible orchestration via message broker |
| `cognitive` | Plan → Generate → Evaluate | Orchestrator-driven adaptive execution (Q2 new) |

**DAG Execution Features:**
- Parallel execution of independent branches
- Circular dependency detection, edge validation
- Atomic node claiming (prevents race conditions in parallel execution)
- Per-node retry with error classification (retryable vs non-retryable)
- Failed dependency propagation (downstream nodes skipped automatically)
- `approval` node type for Human-in-the-Loop gates

**State Machine Features:**
- State types: `task`, `choice` (conditional), `wait` (timed delay), `succeed`/`fail`
- Condition evaluation via path resolution (`$.input.*`, `$.nodes.*`)
- Infinite loop detection (max steps = state count × 10)

**Human-in-the-Loop (Approval Gates):**
- DAG nodes typed as `approval` pause workflow for human decision
- `ApprovalManager`: request / approve / reject / timeout lifecycle
- HTTP callback notification on approval request
- Configurable timeout with auto-approve or auto-reject fallback
- Events: `APPROVAL_REQUESTED`, `APPROVED`, `REJECTED`, `TIMED_OUT`

**Workflow Lifecycle:**
- Concurrent workflow limit (default 10)
- Global timeout per workflow (default 5 minutes)
- Pause / resume / cancel support
- Cleanup with 1-hour retention for status queries

---

### Memory System (`memory/`)

| Component | File | Purpose |
|-----------|------|---------|
| **MemoryManager** | `memory/manager.ts` | KV storage + conversation history (SQLite-backed) |
| **InMemoryVectorStore** | `memory/vector-store.ts` | In-memory vector store with cosine similarity search |
| **SemanticMemory** | `memory/semantic.ts` | High-level semantic memory (embed + store + retrieve) |
| **CognitiveMemory** | `memory/cognitive.ts` | Three-tier episodic/semantic/procedural memory |
| **LLMEmbeddingProvider** | `memory/embeddings.ts` | Hash-based dev embeddings + OpenAI-compatible API |

**Memory Tiers (Cognitive Memory):**

| Tier | Type | Content |
|------|------|---------|
| Episodic | Event-based | Past interactions, tool call outcomes, errors |
| Semantic | Fact-based | Domain knowledge, entity relationships |
| Procedural | Skill-based | Learned workflows, step patterns |

**Features:**
- KV storage with optional TTL expiration
- Conversation history (user/assistant/tool turns) with tool call tracking
- **Proactive Memory Recall** — relevant memories injected before each turn automatically
- Vector search with metadata filtering (exact match + array `in` filters)
- Batch embedding with sequential index validation (100 docs/batch)
- Cognitive memory with active recall on query similarity

---

### Guardrail System (`guardrails/`)

| Component | File | Purpose |
|-----------|------|---------|
| **GuardrailRunner** | `guardrails/index.ts` | Orchestrates input/output guardrail evaluation |
| **OutputValidator** | `guardrails/validators.ts` | JSON schema validation with recursion depth limits |

**Built-in Guardrails:**

| Type | Detection | Severity |
|------|-----------|----------|
| `content-safety` | Regex patterns for harmful content | critical |
| `pii-detection` | Email, phone, SSN, credit card (with Luhn validation) | medium-high |
| `prompt-injection` | "ignore previous", "DAN mode", etc. | critical |
| `schema-validation` | JSON schema against config schema | high |

**Custom Guardrails:**
- LLM-based evaluation with configurable prompt + model
- Three actions: `block` (stop), `warn` (log + continue), `rewrite` (LLM rewrites)
- **Rewrite depth limited to 3** to prevent infinite recursion token blow-up
- Applies to `input`, `output`, or `both` directions
- Fails open on evaluation errors to avoid blocking legitimate content

---

### Policy Engine (`policy/`)

Rule-based evaluation with expression language for access control and compliance.

**Expression Operators:**
- Equality: `field == "value"`, `field != "value"`
- Comparison: `field > 100`, `field < 50`
- Pattern: `field matches "regex"` (max 200-char pattern, 10K-char input — ReDoS guard)
- Containment: `field contains "substring"`
- Boolean: `&&`, `||` combinators

**Enforcement Modes:** `enforce` (block on violation) | `warn` (log only) | `audit` (record for review)

**Strategy Weights:** Configurable numeric weights per rule for priority-based evaluation.

---

### Event System (`event/`)

- **EventBus** (`event/bus.ts`) — Async pub/sub with topic-based subscriptions, backpressure control, managed listener counts
- **EventStore** (`event/store.ts`) — SQLite-backed event persistence for replay and audit
- 30+ event types across 9 subsystems (see Event System section below)

---

### Error Handling (`error/`)

- **MatrixError** hierarchy — unified error taxonomy with codes, severity, retryability
- **WorkflowError** — runId-contextual workflow errors
- **ResourceNotFoundError** — missing agent/workflow/node
- **classifyError()** — categorizes errors as retryable vs non-retryable with backoff hints

---

### Metrics (`metrics/`)

Prometheus-compatible metric collection:

| Metric | Type | Labels |
|--------|------|--------|
| `workflow_runs_total` | Counter | workflow_id |
| `workflow_runs_active` | Gauge | — |
| `workflow_run_duration_seconds` | Histogram | workflow_id, status |
| `workflow_node_duration_seconds` | Histogram | workflow_id, node_id, agent_id |
| `agent_errors_total` | Counter | workflow_id, node_id |
| `events_published_total` | Counter | event_type |

---

## New Capabilities (2026 Q2)

These features were added in Q2 2026, elevating TheMatrix beyond basic orchestration.

### Cognitive Workflow Engine (`workflow/cognitive.ts`)

A fourth workflow mode driven by an orchestrator agent that adaptively plans, generates, and evaluates execution:

```
Plan Phase      → Orchestrator decomposes the task into sub-goals
Generate Phase  → Sub-agents execute each sub-goal in parallel or sequence
Evaluate Phase  → Reflection agent scores outputs, decides retry or proceed
```

- Orchestrator uses `plan-and-execute` agent loop internally
- Sub-agents receive isolated context windows
- Evaluation score threshold configurable (default 0.7)
- Supports up to 3 plan revision cycles before escalation

---

### Workflow Checkpoint & Resume (`workflow/checkpoint.ts`)

Persists workflow state after each node completes, enabling recovery from crashes or timeouts.

| Component | Purpose |
|-----------|---------|
| **SqliteCheckpointStore** | Persists node outputs, run state, cursor into SQLite |
| Engine integration | Auto-saves after each successful node completion |
| Resume API | `workflowEngine.resume(runId)` restores from last checkpoint |

**Key Properties:**
- Crash-safe: interrupted workflows resume from last completed node
- Compatible with all 4 workflow modes (DAG, SM, Dynamic, Cognitive)
- Checkpoint data includes: completed nodes, node outputs, workflow input, cursor position
- Storage in same SQLite database as events (configurable path via `MATRIX_DATA_DIR`)

---

### Self-Healing Strategy (`workflow/self-healing.ts`)

A meta-agent strategy that automatically diagnoses and recovers failed workflows without human intervention.

```
Failure Detected
      ↓
SelfHealingStrategy.diagnose(error, context)
      ↓
Meta-Agent analyzes: error type, node history, resource state
      ↓
Recovery Action: retry | skip-node | substitute-agent | escalate
      ↓
Resume Workflow
```

**Recovery Actions:**

| Action | Trigger Condition | Behavior |
|--------|------------------|----------|
| `retry` | Transient errors (network, timeout) | Re-execute failed node with backoff |
| `skip-node` | Non-critical optional nodes | Mark as skipped, continue downstream |
| `substitute-agent` | Agent capability mismatch | Route to fallback agent from registry |
| `escalate` | Unrecoverable / repeated failures | Emit alert, pause workflow, notify |

**This is an industry-leading capability** — most peer frameworks (LangGraph, CrewAI, OpenAI Agents SDK) have no equivalent built-in self-healing.

---

### Natural Language Workflow Creator (`workflow/nl-creator.ts`)

Converts natural language instructions into fully validated `WorkflowDefinition` + agent YAML definitions:

```
User: "When Jira creates a P0 Bug, analyze logs, generate fix suggestions,
       and notify the Feishu group"
      ↓
NLWorkflowCreator.create(text)
      ↓
Orchestrator Meta-Agent: Plan → Generate → Validate
      ↓
WorkflowDefinition (DAG) + AgentDefinition[] (validated against Zod schemas)
```

**Playground API Endpoints** (served by Monitor package):

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/playground/turn` | POST | Interactive single agent turn |
| `/playground/history` | GET | Conversation history for agent |
| `/playground/clear` | POST | Reset agent conversation |
| `/playground/nl-create` | POST | Natural language → workflow YAML |

---

### MCP Integration (@thematrix/mcp)

The Model Context Protocol integration enables tool interoperability with external MCP servers and exposes TheMatrix capabilities as MCP tools.

| Component | File | Purpose |
|-----------|------|---------|
| **MCPClient** | `client.ts` | Connects to external MCP servers (stdio + HTTP transport) |
| **MCPServer** | `server.ts` | Exposes TheMatrix tools via JSON-RPC over stdio |
| **AgentTools** | `agent-tools.ts` | MCP tool definitions for agent operations |
| **WorkflowTools** | `workflow-tools.ts` | MCP tool definitions for workflow operations |
| **A2AServer** | `a2a-server.ts` | Basic Agent-to-Agent protocol server |

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

### Evaluation Framework (@thematrix/eval)

Systematic testing of agent output quality with concurrent execution.

| Component | File | Purpose |
|-----------|------|---------|
| **EvalRunner** | `runner.ts` | Concurrent eval suite execution with semaphore-based concurrency |
| **Metrics** | `metrics.ts` | 5 built-in metric types |
| **Reporter** | `reporter.ts` | Results formatting and output |
| **SuiteLoader** | `suite-loader.ts` | YAML eval suite loading |

**Built-in Metric Types:**

| Metric | Type | Scoring |
|--------|------|---------|
| `exact-match` | String | 1.0 if output === expected |
| `contains` | String | 1.0 if output contains expected |
| `json-validity` | Schema | 1.0 if valid JSON (optional key check) |
| `llm-judge` | LLM | 0-10 score normalized to 0.0-1.0 |
| `semantic-similarity` | Embedding | Cosine similarity between output and expected |

**Execution:** configurable concurrency, per-case timeout, result ordering preserved, fresh agent runtime per case.

---

## Subsystem Details

### 1. Provider System (@thematrix/providers)

Abstracts LLM access through a plugin architecture supporting 14 providers.

**Components:**
- **ProviderRegistry** — Plugin registration and lifecycle management
- **TokenPool** — Budget allocation, rate limiting (RPM/TPM/concurrent), cost tracking, 80% threshold alerts
- **ProviderRouter** — Request routing with **5 strategies**
- **SecretManager** — Credential resolution from env vars, files, or vault with caching
- **CJK-aware token estimator** — Accurate token counting for Chinese/Japanese/Korean text

**Routing Strategies (5):**

| Strategy | Description |
|----------|-------------|
| `priority` | Ordered fallback: try provider 1, then 2, etc. |
| `round-robin` | Cyclic distribution across healthy providers |
| `least-cost` | Routes to provider with lowest estimated token cost |
| `least-latency` | Routes to provider with lowest recent P50 latency |
| `failover` | Uses primary; switches to backup on error |

**Supported Providers (14):**

| Category | Providers |
|----------|-----------|
| Cloud — Global | OpenAI, Anthropic, Google Gemini, Azure OpenAI, Mistral, Groq |
| Cloud — China | DeepSeek, Moonshot/Kimi, MiniMax, Alibaba Qwen |
| Aggregators | OpenRouter (200+ models), HuggingFace |
| Self-Hosted | Ollama, vLLM |
| IDE Integrations | OpenCode, KimiCode |

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

---

### 2. Execution System (@thematrix/executor)

Four execution backends implementing a common `ExecutionBackend` interface:

| Backend | Transport | Use Case |
|---------|-----------|----------|
| **Local** | In-process AgentRuntime | Development, testing |
| **Docker** | Docker Engine REST API | Isolated container execution |
| **SSH** | SSH + remote shell | Remote server execution |
| **Kubernetes** | K8s Jobs API | Production cluster execution |

`ExecutorManager` routes tasks to the appropriate backend based on configuration. Workspace management handles input/output file staging for remote backends.

**Progressive deployment path:** Local → Docker → SSH → Kubernetes

---

### 3. Gateway System (@thematrix/gateway)

Node.js HTTP server receiving webhooks from 8 platforms and normalizing them into `TriggerEvent` objects.

**Channel Adapters:**

| Platform | Signature Method | Event Types |
|----------|-----------------|-------------|
| Gerrit | HMAC-SHA256 | patchset-created, change-merged, comment-added |
| Jira | HMAC-SHA256 (x-hub-signature) | issue_created, issue_updated, comment_created |
| GitLab | Token (X-Gitlab-Token) | push, merge_request, note, pipeline |
| Feishu/Lark | HMAC-SHA256 (timestamp+nonce) | message, interactive |
| WeChat Work | SHA1 (token+timestamp+nonce) | text, event |
| DingTalk | HMAC-SHA256 (timestamp+secret) | text, interactive |
| Slack | HMAC-SHA256 (v0 signing) | message, app_mention |
| Custom | Configurable | Any |

**Security:** All signature verifications use `timingSafeEqual` to prevent timing attacks.  
**Rate limiting:** Per-channel with automatic cleanup of expired windows.  
**Body size limit:** 10MB maximum per request.

---

### 4. Scheduler System (@thematrix/scheduler)

**CronScheduler:**
- Custom 5-field cron parser (minute, hour, day-of-month, month, day-of-week)
- Timezone support via `Intl.DateTimeFormat` (no external dependencies)
- Range, step, and list expressions (`*/5`, `1-5`, `1,3,5`)

**TriggerMatcher:**
- 7 condition operators: `equals`, `not_equals`, `contains`, `matches`, `in`, `gt`, `lt`
- JSONPath field resolution for nested event data
- Cooldown and `maxConcurrent` enforcement per trigger

---

### 5. Monitoring System (@thematrix/monitor)

**REST API — 16 routes:**

| Group | Routes |
|-------|--------|
| Workflows | list, get, cancel, approve/reject |
| Agents | list, get status |
| Token budget | usage, summary |
| Cluster | nodes, health |
| Triggers | list, history |
| Metrics | Prometheus scrape endpoint |
| Health | system health aggregation |
| Alerts | list active alerts |
| Playground | turn, history, clear, nl-create |

**SSE Manager:** Real-time event streaming to dashboard clients with type-based filtering.  
**AlertManager:** Threshold-based rules with severity levels, duration tracking, and cooldown periods.  
**HealthAggregator:** Collects health checks from all subsystems.

---

### 6. Cluster System (@thematrix/cluster)

Enables horizontal scaling across multiple TheMatrix nodes.

**Components:**
- **NodeRegistry** — Node registration with heartbeat tracking and offline detection
- **WorkDistributor** — HTTP-based task submission with 30-second timeout
- **ClusterHealthMonitor** — Periodic health checks of all registered nodes

**Distribution Strategies (4, with configurable weights):**

| Strategy | Description |
|----------|-------------|
| `round-robin` | Cyclic distribution across healthy nodes |
| `least-loaded` | Routes to node with lowest current load |
| `resource-aware` | Considers CPU, memory, GPU availability |
| `label-match` | Matches task labels against node capability labels |

**Node Lifecycle:** register → heartbeat → drain → deregister  
Node draining gracefully completes in-flight tasks before removal.

---

## Event System

The event bus implements an event sourcing pattern. All state changes are emitted as domain events, stored in SQLite, and broadcast to SSE clients.

**30+ event types across 9 subsystems:**

```
WORKFLOW_*    Workflow lifecycle (started, completed, failed, cancelled, paused, resumed)
AGENT_*       Agent lifecycle (started, completed, error, message, handoff)
NODE_*        DAG node execution (started, completed, failed, skipped, approval)
TRIGGER_*     Webhook triggers (received, matched, fired)
TOKEN_*       Token budget (consumed, warning, exceeded)
CLUSTER_*     Cluster management (registered, deregistered, offline, drained)
EXECUTION_*   Backend execution (started, completed, failed)
ALERT_*       Alert lifecycle (fired, resolved, acknowledged)
SCHEDULE_*    Cron scheduling (fired)
```

Events include **typed payloads** (10 strongly-typed event payload interfaces added in Q2).

---

## Configuration

All configuration is defined in `matrix.config.yaml` and validated with Zod schemas at startup:

```yaml
providers:
  - name: anthropic
    credentials: { type: env, ref: ANTHROPIC_API_KEY }
    models: [claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5]

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

**Environment-based overrides** via `EnvironmentManager` — per-env provider config, execution backend, and variables.

---

## Design Patterns

| Pattern | Usage |
|---------|-------|
| **Event Sourcing** | All state changes emitted as DomainEvents, stored for replay and audit |
| **Plugin/Adapter** | Provider plugins, channel adapters, execution backends |
| **Registry** | Central registries for providers, agents, workflows, cluster nodes |
| **Strategy** | Routing strategies, distribution strategies, execution modes, enforcement modes |
| **Observer** | SSE streaming, event bus subscriptions, alert monitoring |
| **Factory** | `createOpenAICompatiblePlugin` for provider family creation |
| **Mediator** | EventBus + SchedulerManager decouple subsystem communication |
| **Mutex/Guard** | `runTurn()` concurrency protection, cleanup race prevention |
| **Checkpoint** | Workflow state persistence for crash recovery and resume |

---

## Security Measures

| Measure | Implementation |
|---------|---------------|
| **Webhook Signature Verification** | HMAC-SHA256 with `timingSafeEqual` on all 8 platform adapters |
| **Secret Management** | Credentials via env vars, files, or vault — never stored in YAML |
| **Input Sanitization** | SSH commands sanitized; prototype pollution guards on JSON path resolution |
| **Rate Limiting** | Per-provider RPM/TPM/concurrent limits enforced by TokenPool |
| **Body Size Limits** | Gateway enforces 10MB maximum per request |
| **ReDoS Protection** | Regex matching limited to 10K-character inputs, 200-char patterns |
| **Timeout Guards** | All external HTTP calls have abort timeouts |
| **Guardrail Recursion Limit** | Max 3 rewrite cycles per guardrail to prevent DoS |
| **Concurrent Turn Mutex** | `runTurn()` mutex prevents state corruption on same agent instance |
| **SQL Parameterization** | Parameterized queries throughout SQLite usage (cognitive memory) |

---

## Deployment Options

| Mode | Command | Description |
|------|---------|-------------|
| **Local Dev** | `pnpm dev` | All packages in watch mode |
| **Docker Single** | `docker-compose up` | matrix-server + optional Ollama |
| **Docker Cluster** | `docker-compose -f docker-compose.cluster.yml up` | 1 control + 2 worker nodes |
| **Kubernetes** | `kubectl apply -f k8s/` | Full production manifests |

**Kubernetes manifests** (`k8s/`):
- `namespace.yaml` — `thematrix` namespace
- `deployment.yaml` — Server with liveness/readiness probes
- `configmap.yaml` — Configuration injection
- `rbac.yaml` — ServiceAccount + ClusterRole for K8s Jobs API
- `service.yaml` — ClusterIP service (ports 3001 + 3002)
- `job-template.yaml` — Agent execution Job template

**Exposed Ports:**
- `3001` — Monitor REST API + SSE
- `3002` — Gateway webhook receiver
- `3000` — Dashboard (Next.js)

---

## Build & Test

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages (turborepo, dependency-ordered)
pnpm test             # Run all tests (vitest, 124 tests)
pnpm typecheck        # TypeScript strict type checking
pnpm lint             # ESLint
```

**Test Coverage (Q2 2026):**

| Package | Tests | Coverage |
|---------|-------|----------|
| `@thematrix/core` | 86 | AgentRuntime, Guardrails, Workflow engine |
| `@thematrix/providers` | 38 | TokenPool, routing strategies |
| `@thematrix/utils` | — | Core utilities |
| `@thematrix/config` | — | Schema loading |
| `@thematrix/adapters` | — | Base adapter class |
| Other 8 packages | 0 | Gateway, cluster, monitor, eval, executor, mcp, scheduler |

Overall estimated path coverage: ~35% (industry target: 70%+)

---

## Strategic Positioning (2026 Q2)

### Agent Governance Platform

The four governance pillars embedded in TheMatrix's current architecture:

```
┌──────────────────────────────────────────────────────────┐
│           Agent Governance Platform (TheMatrix)           │
├──────────────────────────────────────────────────────────┤
│  1. Identity & Access          2. Safety & Compliance    │
│     Non-human principal           Runtime guardrails     │
│     Scoped permissions            PII/injection detect.  │
│     Secret management             Audit trails (SQLite)  │
│     Delegation chains (A2A)       EU AI Act alignment    │
├──────────────────────────────────────────────────────────┤
│  3. Cost & Performance         4. Quality & Reliability  │
│     Token budgets per agent       Evaluation suites      │
│     5-strategy routing            Trajectory analysis    │
│     CJK-aware token counting      Self-healing recovery  │
│     Usage analytics               Checkpoint/Resume      │
└──────────────────────────────────────────────────────────┘
```

**Why this positioning:** Deloitte (2026.02) found 81% of enterprise agents are running but only **14.4% have full security approval**. Enterprise CIOs have shifted from "can we build this?" to "can we govern this at scale?" TheMatrix's existing event sourcing, guardrails, token pool, and policy engine directly address this need.

---

## Capability Comparison (2026 Q2)

| Capability | TheMatrix | LangGraph 1.1 | CrewAI | Claude Agent SDK | OpenAI Agents SDK |
|------------|-----------|---------------|--------|------------------|-------------------|
| Orchestration modes | DAG+SM+Dynamic+**Cognitive** | Graph | Role-based | Subagent | Handoff |
| Checkpoint/Resume | ✅ | ✅ native | ❌ | ❌ | ❌ |
| Cluster execution | ✅ Local/Docker/SSH/K8s | ❌ | ❌ | ❌ | ❌ |
| Token governance | ✅ TokenPool + budgets | ⚠️ external | ⚠️ | ❌ | ⚠️ |
| Cost routing (5 strats) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Webhook adapters | ✅ 8 platforms | ❌ | ❌ | ❌ | ❌ |
| Cognitive memory (3-tier) | ✅ | ❌ | ⚠️ | ⚠️ | ⚠️ |
| Proactive memory recall | ✅ | ❌ | ❌ | ❌ | ❌ |
| Guardrails (built-in) | ✅ | ❌ external | ⚠️ | ✅ Hooks | ⚠️ |
| **Self-Healing** | ✅ | ❌ | ❌ | ⚠️ manual | ❌ |
| **NL Workflow creation** | ✅ | ❌ | ❌ | ⚠️ partial | ❌ |
| MCP Server + Client | ✅ | ⚠️ | ⚠️ | ✅ deep | ✅ Remote |
| A2A Protocol | ⚠️ partial | ❌ | ❌ | ❌ | ❌ |
| AG-UI Protocol | ❌ | ❌ | ❌ | ❌ | ❌ |
| Prompt Caching | ❌ | ⚠️ partial | ❌ | ✅ | ✅ |
| Test coverage | ~35% | ~70% | ~65% | ~85% | ~80% |
| Multi-language SDK | ❌ TS only | ✅ Py+TS | ⚠️ Py | ✅ | ✅ Py+TS |

**TheMatrix unique advantages:** cluster execution, 8-platform webhook, cognitive workflow, self-healing, NL creation, complete cost governance, China tech ecosystem (14 providers, 4 IM platforms).

**Priority gaps to close:** A2A protocol v1.0, AG-UI protocol, Prompt Caching, Python SDK, test coverage to 70%+.

---

## Roadmap (2026)

### P0 — Strategic (Must Do)

| Item | Description | Impact |
|------|-------------|--------|
| **A2A v1.0 Full Support** | Complete A2A Client + Gateway bridge, OAuth2/SSO, multi-tenant | Ecosystem interoperability |
| **Prompt Caching** | Anthropic/OpenAI prefix caching in adapters | 40-90% cost reduction |
| **MCP Tasks Primitive** | Async task handles for long-running MCP tool calls | Protocol compliance |
| **Test Coverage to 70%** | Gateway, cluster, monitor, eval, executor packages | Production reliability |

### P1 — High Value

| Item | Description |
|------|-------------|
| **AG-UI Protocol** | Standardized agent↔frontend event streaming (CopilotKit compatible) |
| **Multi-Tenant Architecture** | Org → Team → Project RBAC, token quota per team, audit logs |
| **Prompt Caching Metrics** | Cache hit ratio, savings tracking in TokenPool |
| **LOCOMO Memory Benchmark** | Standardized long-term memory evaluation |

### P2 — Platform Maturity

| Item | Description |
|------|-------------|
| **Agent Playground UI** | Interactive debug in Dashboard (ReactFlow DAG canvas) |
| **Visual Workflow Editor** | Drag-and-drop DAG builder |
| **Memory Inspector** | Live KV/vector/cognitive memory view in Dashboard |
| **Python SDK** | Multi-language support (currently TypeScript-only) |
| **Eval Regression Dashboard** | Track agent quality across releases |

---

## Codebase Metrics (Q2 2026)

| Metric | Value |
|--------|-------|
| TypeScript source files | 140 |
| Non-test source lines | ~26,600 |
| Test files | 10 |
| Test cases | 124 |
| Monorepo packages | 13 + 2 apps |
| Supported LLM providers | 14 |
| Platform webhook adapters | 8 |
| Workflow modes | 4 (DAG, SM, Dynamic, Cognitive) |
| Agent execution modes | 3 (single-turn, loop, plan-and-execute) |
| Execution backends | 4 (Local, Docker, SSH, K8s) |
| Cluster distribution strategies | 4 |
| Provider routing strategies | 5 |
| Built-in guardrail types | 4 |
| Eval metric types | 5 |
| REST API routes (monitor) | 16 |
| Event types | 30+ |

