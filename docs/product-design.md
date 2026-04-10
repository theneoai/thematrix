# TheMatrix - Product Design Document

> 版本: 2.0 | 更新时间: 2026-04-10 | 基于行业最新 Agentic AI 趋势深度调研

---

## 1. Product Vision

TheMatrix is an **AI-native Agent Operating System** that enables organizations to define, deploy, and operate multi-agent workflows at enterprise scale. It bridges the gap between standalone AI assistants and production-grade automation by providing a complete infrastructure layer for orchestrating AI agents across distributed systems.

**Mission:** Make multi-agent AI workflows as manageable, observable, and reliable as traditional CI/CD pipelines.

**2026 Product Vision Upgrade:** From "orchestration framework" to **Agent OS** — covering the complete Agent workload lifecycle from development, testing, deployment, to operations.

```
开发态 (Dev)         测试态 (Test)           部署态 (Deploy)         运维态 (Ops)
─────────────────   ─────────────────────   ─────────────────────   ────────────────────
Agent Playground  → Eval + A/B Testing   → Canary Release        → Self-Healing
YAML + CLI          Trajectory Replay       Feature Flags            Cost Optimization
Template Market     Regression Detection    Environment Promotion    Anomaly Detection
```

---

## 2. Target Users

### Primary Users

| User Persona | Role | Key Needs |
|-------------|------|-----------|
| Platform Engineers | Build internal AI tooling | Extensible plugin system, multi-provider support, Kubernetes-native deployment |
| DevOps Teams | Automate development workflows | Webhook integrations, cron scheduling, monitoring dashboards |
| AI/ML Engineers | Design agent workflows | DAG/state-machine execution, memory management, token budget controls |
| Engineering Managers | Oversee AI adoption | Cost tracking, usage metrics, audit trails via event sourcing |

### Secondary Users

- Security teams needing automated code review and vulnerability scanning
- QA teams automating test generation and bug triage
- Documentation teams maintaining AI-assisted technical writing pipelines
- Business analysts building no-code/low-code automation workflows

---

## 3. Use Cases

### 3.1 Automated Code Review Pipeline

A multi-agent DAG workflow triggered by GitLab merge requests:
1. **Analyzer Agent** examines the diff for structural changes
2. **Security Reviewer** checks for vulnerabilities (runs in parallel)
3. **Performance Reviewer** identifies performance regressions (runs in parallel)
4. **Summarizer Agent** synthesizes all reviews and posts a comment back to GitLab

Trigger: GitLab webhook on `merge_request` event. Output: Comment posted via GitLab notification adapter.

### 3.2 Bug Triage Automation

Jira webhook triggers an agent workflow when new issues are created:
1. **Classifier Agent** categorizes the bug by component, severity, and area
2. **Reproducer Agent** generates reproduction steps based on description and logs
3. **Router Agent** assigns the issue to the appropriate team and priority queue

### 3.3 Scheduled Compliance Scanning

Cron-scheduled workflow running nightly at 02:00 UTC:
1. **Scanner Agent** audits infrastructure configurations
2. **Reporter Agent** generates compliance report
3. **Notifier** sends results to Slack and DingTalk channels

### 3.4 Multi-Provider Cost Optimization

Using the provider router with `least-cost` strategy:
- Route simple tasks to local Ollama models (zero cost)
- Route complex reasoning to Claude/GPT-4o
- Enforce per-agent token budgets with monthly reset periods
- Alert when cost thresholds are reached

### 3.5 Natural Language Workflow Creation (New)

Using the Orchestrator Meta-Agent:
> "I need a workflow: when Jira creates a P0 Bug, automatically analyze logs, generate fix suggestions, and notify the Feishu group."

The system converts natural language into workflow.yaml + agent definitions, ready to deploy.

### 3.6 Agent Interactive Debugging (New)

Using Agent Playground in Dashboard:
- Developers interact with individual agents in real-time
- View tool call decisions, memory state, and token usage
- Iterate on system prompts with immediate feedback
- Step-through DAG workflow execution node by node

---

## 4. Feature Matrix

### Core Platform

| Feature | Status | Package |
|---------|--------|---------|
| Agent definition (persona, model, skills, tools) | Implemented | @thematrix/types, @thematrix/core |
| Agent loop (3 modes: single-turn, loop, plan-and-execute) | Implemented | @thematrix/core |
| Agent planning (LLM-based task decomposition) | Implemented | @thematrix/core |
| Agent reflection (self-evaluation with quality scoring) | Implemented | @thematrix/core |
| Agent handoff (dynamic agent-to-agent delegation) | Implemented | @thematrix/core |
| Workflow engine (DAG + state-machine + dynamic modes) | Implemented | @thematrix/core |
| Human-in-the-loop approval gates | Implemented | @thematrix/core |
| Input/output guardrails (safety, PII, injection, custom LLM) | Implemented | @thematrix/core |
| Guardrail rewrite depth limiting (anti-recursion) | Implemented | @thematrix/core |
| Structured output validation with retry | Implemented | @thematrix/core |
| Policy engine (rule-based evaluation) | Implemented | @thematrix/core |
| Environment management (per-env config overrides) | Implemented | @thematrix/core |
| Event sourcing with replay | Implemented | @thematrix/core |
| Memory management (KV, vector, conversation) | Implemented | @thematrix/core |
| Memory pre-turn injection (proactive recall) | Implemented | @thematrix/core |
| Semantic memory (embedding + vector search) | Implemented | @thematrix/core |
| Cognitive memory (episodic/semantic/procedural) | Implemented | @thematrix/core |
| MCP protocol (client + server, stdio + HTTP transport) | Implemented | @thematrix/mcp |
| Evaluation framework (5 metric types, concurrent execution) | Implemented | @thematrix/eval |
| YAML configuration with Zod validation | Implemented | @thematrix/config |
| CLI management tool | Implemented | @thematrix/cli |
| Concurrent turn protection (mutex on runTurn) | Implemented | @thematrix/core |
| Natural language workflow creation | Implemented | @thematrix/core |
| Self-healing workflow recovery | Implemented | @thematrix/core |

### Provider System

| Feature | Status | Package |
|---------|--------|---------|
| 14 LLM provider plugins | Implemented | @thematrix/providers |
| Token pool (budget, rate limiting, cost tracking) | Implemented | @thematrix/providers |
| Provider router (5 strategies: priority/round-robin/least-cost/least-latency/failover) | Implemented | @thematrix/providers |
| CJK-aware token estimation | Implemented | @thematrix/providers |
| Latency tracking and adaptive routing | Implemented | @thematrix/providers |
| Secret management (env, file, vault) | Implemented | @thematrix/providers |
| OpenAI-compatible base adapter | Implemented | @thematrix/providers |

### Execution

| Feature | Status | Package |
|---------|--------|---------|
| Local in-process execution | Implemented | @thematrix/executor |
| Docker container execution | Implemented | @thematrix/executor |
| SSH remote execution | Implemented | @thematrix/executor |
| Kubernetes Job execution | Implemented | @thematrix/executor |
| Workspace management | Implemented | @thematrix/executor |

### Integration

| Feature | Status | Package |
|---------|--------|---------|
| 8 webhook platform adapters | Implemented | @thematrix/gateway |
| Cron scheduling with timezone | Implemented | @thematrix/scheduler |
| Event-driven triggers (7 operators) | Implemented | @thematrix/scheduler |
| Bidirectional notifications | Implemented | @thematrix/gateway |
| Rate limit with automatic cleanup | Implemented | @thematrix/gateway |

### Monitoring

| Feature | Status | Package |
|---------|--------|---------|
| REST API (16 routes) | Implemented | @thematrix/monitor |
| SSE real-time streaming | Implemented | @thematrix/monitor |
| Alert rules with severity levels | Implemented | @thematrix/monitor |
| Prometheus-compatible metrics | Implemented | @thematrix/core |
| Health aggregation | Implemented | @thematrix/monitor |
| EventBus backpressure control | Implemented | @thematrix/core |

### Cluster Management

| Feature | Status | Package |
|---------|--------|---------|
| Node registration + heartbeat | Implemented | @thematrix/cluster |
| 4 distribution strategies (configurable weights) | Implemented | @thematrix/cluster |
| Node draining | Implemented | @thematrix/cluster |
| Cluster health monitoring | Implemented | @thematrix/cluster |

### Dashboard

| Feature | Status | Package |
|---------|--------|---------|
| Next.js 15 + React 19 web UI | Implemented | @thematrix/dashboard |
| Dark-first theme | Implemented | @thematrix/dashboard |
| Command palette (Cmd+K) | Implemented | @thematrix/dashboard |
| Real-time SSE updates | Implemented | @thematrix/dashboard |
| 8 page views (overview, workflows, agents, providers, triggers, cluster, alerts, settings) | Implemented | @thematrix/dashboard |
| Agent Playground (interactive debug) | **Planned - Phase 3** | @thematrix/dashboard |
| Visual workflow editor (ReactFlow DAG canvas) | **Planned - Phase 3** | @thematrix/dashboard |
| Memory Inspector | **Planned - Phase 3** | @thematrix/dashboard |
| Eval regression dashboard | **Planned - Phase 3** | @thematrix/dashboard |

---

## 5. New Product Capabilities (2026 Roadmap)

### 5.1 Agent Playground (Interactive Debug Environment)

The current developer experience requires running full workflows to observe agent behavior. The Playground provides real-time interactive debugging:

```
┌─────────────────────────────────────────────────────────┐
│  Agent Playground                                        │
│  ┌─────────────────────┐  ┌────────────────────────────┐ │
│  │  Agent Config        │  │  Chat Window               │ │
│  │  • Model / Temp adj  │  │  User: Analyze this code...│ │
│  │  • System Prompt edit│  │                            │ │
│  │  • Tool permissions  │  │  [Tool Call] read_file()   │ │
│  └─────────────────────┘  │  └─ latency: 120ms          │ │
│  ┌─────────────────────┐  │                            │ │
│  │  Memory Inspector   │  │  Assistant: Found 3 issues │ │
│  │  • KV Store view     │  └────────────────────────────┘ │
│  │  • Conversation hist │  ┌────────────────────────────┐ │
│  │  • Cognitive memory  │  │  Token Usage               │ │
│  └─────────────────────┘  │  Input: 1,234 / Out: 456   │ │
│                           │  Cost: $0.002               │ │
└─────────────────────────────────────────────────────────┘
```

**Key Features:**
- Real-time agent chat with tool call decision transparency
- Live system prompt editing with immediate effect
- Memory state inspector (KV Store, conversation history, cognitive memory)
- Token consumption breakdown per LLM call
- Workflow step-through mode (execute DAG node by node)

### 5.2 Multi-Tenant Architecture

**Three-tier tenant model:**
```
Organization (Enterprise)
  └── Team (Department)
        ├── Project (Project)
        │     ├── Workflow (Workflow definition)
        │     └── Agent (Agent definition)
        └── Token Budget (Per-team quota)
```

**Core capabilities:**
- **RBAC**: Admin (all) / Developer (create + run) / Viewer (read-only)
- **Resource Quotas**: Token budget allocation per Team, workflow concurrency limits
- **Audit Logs**: Who triggered which workflow, when, consuming how many tokens (compliance-ready)
- **API Key Authentication**: Secure access to Monitor API (currently unauthenticated)

### 5.3 Natural Language Workflow Creation

Using an Orchestrator Meta-Agent with Plan→Generate→Validate pipeline:

```typescript
// Implementation in packages/core/src/workflow/nl-creator.ts
class NaturalLanguageWorkflowCreator {
  async createFromDescription(description: string): Promise<WorkflowBundle> {
    const plan = await this.planner.decompose(description);      // Intent decomposition
    const draft = await this.generator.createYaml(plan);        // Generate YAML
    const validated = await this.validator.check(draft);        // Validate executability
    return { workflow: validated.workflow, agents: validated.agents };
  }
}
```

**User Experience:**
> Input: "When Jira creates a P0 Bug, automatically analyze logs, generate fix suggestions, notify Feishu group"
> Output: Deployed workflow with 3 agents + trigger config, ready to run

### 5.4 Agent Template Marketplace

Reduce onboarding friction with pre-built templates:

| Category | Example Templates |
|---------|-----------------|
| Code Quality | Code Review Pipeline, Security Scan, Performance Analysis |
| Project Management | Bug Triage Automation, Sprint Report Generation |
| Operations | Alert Root Cause Analysis, Auto Incident Recovery |
| Content | Tech Documentation Generation, API Docs Update |
| Compliance | GDPR Audit, SOC2 Control Validation |

User flow: **Select template → Fill parameters → One-click deploy**

### 5.5 Observability as a Product Feature

Aligned with Langfuse/Braintrust industry standards:

1. **Trace View**: Complete agent decision chain — input → thinking → tool call → output spans
2. **Prompt Version Management**: Track system prompt changes and corresponding output quality
3. **Cost Attribution**: Token consumption per tool call, aggregatable by business tags
4. **Regression Detection**: Quality comparison between new and old agent versions (A/B)
5. **Trajectory Replay**: Replay historical agent execution paths for debugging

### 5.6 Self-Healing Agent Recovery

When workflows fail, a SelfHealingEvaluator Agent automatically diagnoses and recovers:

```
Workflow execution failure
      ↓
[SelfHealingEvaluator Agent]
  ├── Analyze failure cause (error type + context)
  ├── Query procedural memory (historical success patterns)
  ├── Select recovery strategy:
  │     ├── Downgrade model (Claude → GPT-4o-mini, cost saving)
  │     ├── Decompose task further (finer granularity)
  │     ├── Switch tools (fallback tool)
  │     └── Request human approval (safety net)
  └── Execute recovery → Record to procedural memory
```

---

## 6. User Scenarios

### Scenario A: First-Time Setup

1. User clones the repository and runs `pnpm install && pnpm build`
2. Creates `matrix.config.yaml` with provider credentials and desired integrations
3. Defines agent YAML files for their workflow participants
4. Defines a workflow YAML connecting agents in a DAG
5. Runs `matrix workflow run <workflow-id>` to test locally
6. Deploys with `docker-compose up` for production

### Scenario B: Adding a New Integration

1. User wants to connect to a new GitLab project
2. Adds a GitLab channel configuration to `matrix.config.yaml` with webhook secret
3. Configures GitLab to send webhooks to the gateway URL
4. Adds a trigger rule matching `merge_request` events to a code review workflow
5. Tests by creating a merge request — gateway receives webhook, scheduler matches trigger, workflow executes

### Scenario C: Scaling to a Cluster

1. User starts with single-node Docker deployment
2. As workload grows, switches to `docker-compose.cluster.yml`
3. Configures distribution strategy (e.g., `resource-aware` with custom weights)
4. Registers additional worker nodes
5. Monitor dashboard shows cluster health, node loads, and task distribution
6. Alerts fire if nodes go offline or error rates spike

### Scenario D: Cost Control

1. User configures token pool with global monthly budget of $100
2. Sets per-agent limits to prevent runaway costs
3. Configures provider router with `least-cost` strategy
4. Dashboard shows real-time cost tracking per agent and workflow
5. Alert fires when 80% of budget is consumed
6. Provider router automatically falls back to cheaper models when primary budget is depleted

### Scenario E: Agent Debugging with Playground (New)

1. Developer defines a new code review agent
2. Opens Agent Playground in Dashboard
3. Sends test code snippets and observes agent decisions in real time
4. Inspects which tools were called, what context was retrieved from memory
5. Adjusts system prompt and temperature, observes immediate quality changes
6. Views token breakdown to optimize cost before production deployment

### Scenario F: Natural Language Workflow Creation (New)

1. Product Manager (non-engineer) needs a bug triage automation
2. Describes requirement in plain text in the Dashboard
3. Orchestrator Meta-Agent generates complete workflow YAML + agent definitions
4. PM previews the generated workflow in visual DAG view
5. Makes minor adjustments through UI
6. Deploys with one click, monitors via Dashboard

---

## 7. Architecture Principles

### Event-Driven
All state changes are captured as domain events, enabling audit trails, replay, real-time monitoring, and loose coupling between subsystems.

### Plugin-Based
Providers, execution backends, channel adapters, and distribution strategies are all implemented as plugins with well-defined interfaces, allowing extension without modifying core code.

### Distributed-Optional
The system works as a single process in development mode, scales to multi-container Docker Compose, and runs natively on Kubernetes — same codebase, same configuration format.

### Provider-Agnostic
No lock-in to any LLM provider. The router can failover between providers, balance cost and latency, and mix local/cloud models in the same workflow.

### Configuration-as-Code
All definitions (agents, workflows, triggers, schedules) are YAML files validated with Zod schemas, enabling version control, review, and automated deployment.

### Memory-Augmented Execution
Agents proactively recall relevant episodic, semantic, and procedural memories before each turn, improving decision quality and enabling learning from past experiences.

### Fail-Safe by Default
Security guardrails fail closed (block on evaluation errors). Resource limits (token budgets, concurrent request caps, rate limits) are enforced before execution. All inputs are validated at system boundaries.

---

## 8. Competitive Analysis

| Capability | TheMatrix | Dify | LangChain | CrewAI | AutoGen |
|-----------|-----------|------|-----------|--------|---------|
| Multi-agent workflows | DAG + state-machine + dynamic + cognitive | Visual flow | Chain/graph | Sequential/hierarchical | Conversation |
| Provider support | 14 providers + plugin system | ~10 providers | Many via integrations | OpenAI-focused | OpenAI-focused |
| Execution backends | Local/Docker/SSH/K8s | Cloud only | Local only | Local only | Local only |
| Webhook integrations | 8 platforms (CN + global) | Limited | None built-in | None | None |
| Token budget management | Per-agent/workflow + CJK-accurate estimation | Basic | None | None | None |
| Provider routing | 5 strategies incl. latency-aware | Basic | None | None | None |
| Cluster distribution | 4 configurable strategies | N/A | N/A | N/A | N/A |
| Monitoring | REST + SSE + Prometheus + Alerts + Traces | Built-in UI | LangSmith (paid) | None | None |
| Memory architecture | KV + Vector + Cognitive (3-tier) + Pre-turn recall | Basic | Various | Basic | None |
| Configuration | YAML + Zod validation | Visual UI | Python code | Python code | Python code |
| Deployment | Docker/K8s manifests included | Docker | N/A | N/A | N/A |
| A2A Protocol | Server + Client (emerging) | None | None | None | None |
| MCP Protocol | Client + Server | None | Partial | None | None |
| Self-healing | SelfHealingEvaluator (planned) | None | None | None | None |

### Key Differentiators

1. **Infrastructure-native**: Built for deployment on real infrastructure (Docker, SSH, K8s) rather than just in-process execution
2. **China ecosystem deep integration**: Native Gerrit, Jira, GitLab, Feishu, DingTalk, Slack, WeChat support + 14 LLM providers including all major Chinese models
3. **Enterprise cost governance**: Token pool with budgets, CJK-accurate rate limits, and 5 provider routing strategies
4. **Memory-augmented agents**: Three-tier cognitive memory with proactive pre-turn recall
5. **Observable by default**: Event sourcing, Prometheus metrics, SSE streaming, alert rules, distributed tracing
6. **TypeScript-first**: Full type safety from config validation to runtime, monorepo with shared types
7. **Security guardrails**: Multi-layer (content-safety + PII + prompt-injection + custom LLM) with anti-recursion protection

---

## 9. Roadmap

### Phase 1 (Completed) — Core Platform
- All 13 packages implemented and building
- 14 provider plugins with 5 routing strategies
- 4 execution backends
- 8 webhook integrations
- Dashboard with 8 views
- Three-tier cognitive memory with pre-turn injection
- Security hardening (guardrail recursion limits, concurrent turn mutex, parameterized SQL)
- CJK-aware token estimation
- EventBus backpressure control
- Handoff memory leak prevention

### Phase 2 — Production Hardening
- Comprehensive test coverage (unit + integration, target >60% critical path)
- SQLite persistence for cluster state across restarts
- Graceful shutdown and task migration between nodes
- OAuth/API key authentication for Monitor API
- Multi-tenant foundation (Organization/Team/Project model)
- Audit log export (SIEM integration readiness)

### Phase 3 — Developer Experience
- Agent Playground (interactive debug in Dashboard)
- Memory Inspector UI (visualize KV/vector/cognitive state)
- Visual workflow editor in Dashboard (ReactFlow DAG canvas)
- Eval regression detection dashboard
- A/B testing for agent configurations
- Trajectory replay viewer
- Prompt version management

### Phase 4 — Ecosystem & Enterprise
- Agent Template Marketplace (community-contributed templates)
- Natural Language Workflow Creation (Meta-Agent powered)
- A2A Client — discover and connect to external agent ecosystems
- Self-Healing Evaluator Agent (automatic failure recovery)
- Plugin marketplace for community extensions
- Custom guardrail template library
- Multi-modal support (vision/audio/file input agents)
- High-availability cluster mode with leader election
- Fine-grained RBAC with per-resource permissions
- SLA monitoring and reporting dashboards
