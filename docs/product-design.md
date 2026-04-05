# TheMatrix - Product Design Document

## 1. Product Vision

TheMatrix is an AI-native DevOps orchestration platform that enables organizations to define, deploy, and manage multi-agent workflows at scale. It bridges the gap between standalone AI assistants and enterprise-grade automation by providing a unified framework for orchestrating multiple AI agents across distributed infrastructure.

**Mission:** Make multi-agent AI workflows as manageable and observable as traditional CI/CD pipelines.

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
| Structured output validation with retry | Implemented | @thematrix/core |
| Policy engine (rule-based evaluation) | Implemented | @thematrix/core |
| Environment management (per-env config overrides) | Implemented | @thematrix/core |
| Event sourcing with replay | Implemented | @thematrix/core |
| Memory management (KV, vector, conversation) | Implemented | @thematrix/core |
| Semantic memory (embedding + vector search) | Implemented | @thematrix/core |
| MCP protocol (client + server, stdio + HTTP transport) | Implemented | @thematrix/mcp |
| Evaluation framework (5 metric types, concurrent execution) | Implemented | @thematrix/eval |
| YAML configuration with Zod validation | Implemented | @thematrix/config |
| CLI management tool | Implemented | @thematrix/cli |

### Provider System

| Feature | Status | Package |
|---------|--------|---------|
| 14 LLM provider plugins | Implemented | @thematrix/providers |
| Token pool (budget, rate limiting, cost tracking) | Implemented | @thematrix/providers |
| Provider router (4 strategies + failover) | Implemented | @thematrix/providers |
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

### Monitoring

| Feature | Status | Package |
|---------|--------|---------|
| REST API (16 routes) | Implemented | @thematrix/monitor |
| SSE real-time streaming | Implemented | @thematrix/monitor |
| Alert rules with severity levels | Implemented | @thematrix/monitor |
| Prometheus-compatible metrics | Implemented | @thematrix/core |
| Health aggregation | Implemented | @thematrix/monitor |

### Cluster Management

| Feature | Status | Package |
|---------|--------|---------|
| Node registration + heartbeat | Implemented | @thematrix/cluster |
| 4 distribution strategies | Implemented | @thematrix/cluster |
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

---

## 5. User Scenarios

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
5. Tests by creating a merge request -- gateway receives webhook, scheduler matches trigger, workflow executes

### Scenario C: Scaling to a Cluster

1. User starts with single-node Docker deployment
2. As workload grows, switches to `docker-compose.cluster.yml`
3. Configures distribution strategy (e.g., `resource-aware`)
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

---

## 6. Architecture Principles

### Event-Driven
All state changes are captured as domain events, enabling audit trails, replay, real-time monitoring, and loose coupling between subsystems.

### Plugin-Based
Providers, execution backends, channel adapters, and distribution strategies are all implemented as plugins with well-defined interfaces, allowing extension without modifying core code.

### Distributed-Optional
The system works as a single process in development mode, scales to multi-container Docker Compose, and runs natively on Kubernetes -- same codebase, same configuration format.

### Provider-Agnostic
No lock-in to any LLM provider. The router can failover between providers, balance cost, and mix local/cloud models in the same workflow.

### Configuration-as-Code
All definitions (agents, workflows, triggers, schedules) are YAML files validated with Zod schemas, enabling version control, review, and automated deployment.

---

## 7. Competitive Analysis

| Capability | TheMatrix | Dify | LangChain | CrewAI | AutoGen |
|-----------|-----------|------|-----------|--------|---------|
| Multi-agent workflows | DAG + state-machine | Visual flow | Chain/graph | Sequential/hierarchical | Conversation |
| Provider support | 14 providers + plugin system | ~10 providers | Many via integrations | OpenAI-focused | OpenAI-focused |
| Execution backends | Local/Docker/SSH/K8s | Cloud only | Local only | Local only | Local only |
| Webhook integrations | 8 platforms | Limited | None built-in | None | None |
| Token budget management | Per-agent/workflow with rate limiting | Basic | None | None | None |
| Cluster distribution | 4 strategies | N/A | N/A | N/A | N/A |
| Monitoring | REST + SSE + Prometheus + Alerts | Built-in UI | LangSmith (paid) | None | None |
| Configuration | YAML + Zod validation | Visual UI | Python code | Python code | Python code |
| Deployment | Docker/K8s manifests included | Docker | N/A | N/A | N/A |

### Key Differentiators

1. **Infrastructure-native**: Built for deployment on real infrastructure (Docker, SSH, K8s) rather than just in-process execution
2. **DevOps-focused integrations**: Native Gerrit, Jira, GitLab, Feishu, DingTalk, Slack, WeChat support
3. **Cost governance**: Token pool with budgets, rate limits, and provider routing strategies
4. **Observable by default**: Event sourcing, Prometheus metrics, SSE streaming, alert rules
5. **TypeScript-first**: Full type safety from config validation to runtime, monorepo with shared types

---

## 8. Roadmap

### Phase 1 (Current) -- Core Platform
- All packages implemented and building
- 14 provider plugins
- 4 execution backends
- 8 webhook integrations
- Dashboard with 8 views

### Phase 2 -- Production Hardening
- Comprehensive test coverage (unit + integration)
- SQLite persistence for cluster state
- Graceful shutdown and task migration
- OAuth/API key authentication for monitor API
- Rate limiting on gateway endpoints

### Phase 3 -- Advanced Features
- Visual workflow editor in dashboard (React Flow DAG canvas)
- A/B testing for agent configurations
- Plugin marketplace
- Custom guardrail templates library
- Eval suite dashboard integration

### Phase 4 -- Enterprise
- Multi-tenant isolation
- RBAC with fine-grained permissions
- Audit log export (SIEM integration)
- SLA monitoring and reporting
- High-availability cluster mode with leader election
