# TheMatrix - Multi-Agent Workflow Orchestration System

## Context

TheMatrix is a greenfield multi-agent workflow orchestration system for the `theneoai` organization. The repository currently contains only a LICENSE (MIT) and README. The goal is to build a comprehensive system inspired by Claude Agent SDK that enables:
- Defining custom AI agents with configurable personalities, skills, and tool permissions
- Orchestrating multiple agents in workflows (DAG/state-machine) with shared memory
- Scheduling, monitoring, and managing workflows via CLI and web dashboard
- Integrating with MCP protocol, plugins, and external AI clients (opencode, claude, openclaw, copaw, qclaw)

---

## Architecture Overview

```
                    ┌─────────────┐
                    │   CLI App   │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────┴─────┐ ┌───┴───┐ ┌─────┴─────┐
        │ Dashboard  │ │  MCP  │ │  Plugins  │
        │ (Next.js)  │ │Server │ │   Host    │
        └─────┬──────┘ └───┬───┘ └─────┬─────┘
              │            │            │
        ┌─────┴────────────┴────────────┴─────┐
        │         @thematrix/core              │
        │  ┌──────────┐  ┌──────────────────┐  │
        │  │ Workflow  │  │  Agent Runtime   │  │
        │  │  Engine   │  │  (Lifecycle Mgr) │  │
        │  └────┬─────┘  └───────┬──────────┘  │
        │       │                │              │
        │  ┌────┴────┐  ┌───────┴──────────┐   │
        │  │EventBus │  │ Memory Manager   │   │
        │  │& Store  │  │ (KV/Vector/Chat) │   │
        │  └─────────┘  └─────────────────┘    │
        │       │                               │
        │  ┌────┴──────────┐ ┌──────────────┐  │
        │  │Message Broker │ │ Skill Engine │  │
        │  └───────────────┘ └──────────────┘  │
        └──────────────────────────────────────┘
              │            │            │
        ┌─────┴──────┐ ┌──┴───┐ ┌─────┴──────┐
        │  Adapters   │ │Config│ │   Types    │
        │(LLM/Client) │ │(YAML)│ │(Interfaces)│
        └────────────┘ └──────┘ └────────────┘
```

---

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Monorepo**: pnpm workspaces + Turborepo
- **Build**: tsup (fast bundling)
- **CLI**: Commander.js + Ink (React-based terminal UI)
- **Storage**: In-memory (dev) + SQLite via better-sqlite3 (persistence)
- **Config**: YAML (yaml package) + Zod validation
- **Testing**: Vitest
- **MCP**: @modelcontextprotocol/sdk
- **IDs**: ulid
- **LLM Adapters**: Anthropic, OpenCode, MiniMax, KimiCoding

---

## Monorepo Package Structure

```
thematrix/
├── package.json                    # Root workspace
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
│
├── packages/
│   ├── types/                      # @thematrix/types - All interfaces & types
│   ├── core/                       # @thematrix/core - Engine, runtime, memory, events
│   ├── config/                     # @thematrix/config - YAML parsing & Zod validation
│   ├── adapters/                   # @thematrix/adapters - LLM & client adapters
│   ├── mcp/                        # @thematrix/mcp - MCP server/client
│   ├── plugins/                    # @thematrix/plugins - Plugin host & loader
│   └── utils/                      # @thematrix/utils - Logger, ID gen, retry
│
├── apps/
│   ├── cli/                        # @thematrix/cli - CLI management tool
│   └── dashboard/                  # @thematrix/dashboard - Web UI
│
├── skills/                         # Built-in skill packages
│   ├── web-search/
│   ├── code-analysis/
│   └── file-operations/
│
└── examples/                       # Example workflows & agents
    ├── simple-pipeline/
    ├── code-review/
    └── multi-agent-chat/
```

---

## Core Data Models (Key Interfaces)

### Agent (`packages/types/src/agent.ts`)

```typescript
export type AgentStatus = 'created' | 'initializing' | 'running' | 'paused' | 'stopping' | 'stopped' | 'error';

export interface AgentDefinition {
  id: string;
  name: string;
  version: string;
  persona: AgentPersona;
  model: ModelConfig;
  skills: SkillRef[];
  tools: ToolPermission[];
  memory: AgentMemoryConfig;
  maxConcurrency: number;
  turnTimeoutMs: number;
  metadata: Record<string, unknown>;
}

export interface AgentPersona {
  systemPrompt: string;
  personality: string;       // e.g. "meticulous and detail-oriented"
  role: string;              // e.g. "researcher", "critic"
  temperature?: number;
  traits: Record<string, string>;
}

export interface ModelConfig {
  provider: string;          // "anthropic" | "openai" | "ollama"
  model: string;
  apiKeyEnvVar?: string;
  baseUrl?: string;
  maxTokens?: number;
}

export interface AgentInstance {
  instanceId: string;
  definitionId: string;
  workflowRunId: string;
  status: AgentStatus;
  metrics: AgentMetrics;
}
```

### Workflow (`packages/types/src/workflow.ts`)

```typescript
export type WorkflowStatus = 'draft' | 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'timed_out';
export type ExecutionMode = 'dag' | 'state-machine';

export interface WorkflowDefinition {
  id: string;
  name: string;
  version: string;
  mode: ExecutionMode;
  agents: Record<string, AgentRef>;
  dag?: DAGDefinition;              // nodes + edges
  stateMachine?: StateMachineDefinition;
  sharedMemory: WorkflowMemoryConfig;
  schedule?: ScheduleConfig;        // cron, startAt, maxDurationMs
  integrations?: IntegrationConfig[];
  timeoutMs?: number;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export interface DAGDefinition {
  nodes: DAGNode[];                 // id, agentId, type, inputMapping, condition, retry
  edges: DAGEdge[];                 // from, to, condition
}

export interface StateMachineDefinition {
  initialState: string;
  states: Record<string, StateDefinition>;  // task/parallel/choice/wait/terminal
}

export interface ScheduleConfig {
  cron?: string;
  startAt?: string;                 // ISO 8601
  maxDurationMs?: number;
  timezone?: string;
}
```

### Memory (`packages/types/src/memory.ts`)

```typescript
export type MemoryScope = 'agent-local' | 'workflow-shared' | 'global';

export interface IMemoryManager {
  // KV store
  get(scope: MemoryScope, ownerId: string, key: string): Promise<unknown | undefined>;
  set(scope: MemoryScope, ownerId: string, key: string, value: unknown, ttlMs?: number): Promise<void>;
  delete(scope: MemoryScope, ownerId: string, key: string): Promise<boolean>;
  list(scope: MemoryScope, ownerId: string, prefix?: string): Promise<MemoryEntry[]>;
  // Vector memory
  embed(scope: MemoryScope, ownerId: string, content: string, metadata?: Record<string, unknown>): Promise<string>;
  search(scope: MemoryScope, ownerId: string, query: string, topK?: number): Promise<VectorMemoryEntry[]>;
  // Conversation history
  appendTurn(agentInstanceId: string, turn: ConversationTurn): Promise<string>;
  getHistory(agentInstanceId: string, limit?: number): Promise<ConversationTurn[]>;
}
```

### Events & Messages (`packages/types/src/event.ts`, `message.ts`)

```typescript
export interface DomainEvent<T = unknown> {
  eventId: string;
  type: string;                     // "agent.started", "workflow.node.completed"
  source: { kind: 'agent' | 'workflow' | 'system'; id: string };
  timestamp: Date;
  payload: T;
  correlationId: string;            // workflow run id
}

export interface IEventBus {
  publish(event: DomainEvent): Promise<void>;
  subscribe(pattern: string, handler: EventHandler): Unsubscribe;
  replay(fromEventId?: string, filter?: EventFilter): AsyncIterable<DomainEvent>;
}

export interface AgentMessage {
  messageId: string;
  fromAgentId: string;
  toAgentId: string | '*';          // '*' = broadcast
  workflowRunId: string;
  type: 'request' | 'response' | 'notification' | 'command';
  content: MessageContent;          // text | structured | tool-result | handoff
  priority: 'low' | 'normal' | 'high' | 'critical';
}

export interface IMessageBroker {
  send(message: AgentMessage): Promise<void>;
  receive(agentId: string, workflowRunId: string): AsyncIterable<AgentMessage>;
  request(message: AgentMessage, timeoutMs?: number): Promise<AgentMessage>;
  subscribe(channel: string, handler: (msg: AgentMessage) => void): Unsubscribe;
}
```

### Skill (`packages/types/src/skill.ts`)

```typescript
export interface SkillDefinition {
  id: string;
  name: string;
  version: string;
  description: string;
  entryPoint: string;
  tools: SkillToolDefinition[];
  permissions: SkillPermission[];
  configSchema?: Record<string, unknown>;
}

export interface SkillModule {
  initialize(context: SkillContext): Promise<void>;
  dispose?(): Promise<void>;
  handlers: Record<string, SkillToolHandler>;
}
```

---

## Configuration File Format (YAML)

### Agent Definition (`researcher.agent.yaml`)

```yaml
id: researcher-v1
name: Research Agent
version: "1.0.0"

persona:
  systemPrompt: |
    You are a meticulous research agent. Your job is to gather,
    verify, and synthesize information from multiple sources.
  personality: "meticulous, thorough, citation-focused"
  role: researcher
  temperature: 0.3
  traits:
    communication_style: "formal and precise"
    expertise: "academic research, fact-checking"

model:
  provider: anthropic
  model: claude-sonnet-4-20250514
  apiKeyEnvVar: ANTHROPIC_API_KEY
  maxTokens: 4096

skills:
  - skillId: web-search
    config:
      maxResults: 10
  - skillId: file-operations
    config:
      allowedPaths: ["./data", "./output"]

tools:
  - name: read_file
    permission: allow
  - name: write_file
    permission: confirm
  - name: execute_code
    permission: deny

memory:
  persistHistory: true
  maxHistoryTurns: 50
  scopes:
    - scope: agent-local
      access: read-write
    - scope: workflow-shared
      access: read-write
    - scope: global
      access: read

maxConcurrency: 1
turnTimeoutMs: 60000
```

### Workflow Definition (`code-review.workflow.yaml`)

```yaml
id: code-review-pipeline
name: Automated Code Review
version: "1.0.0"
description: "Multi-agent pipeline for comprehensive code review"
mode: dag

agents:
  analyzer:
    ref: ./agents/analyzer.agent.yaml
  reviewer:
    ref: ./agents/reviewer.agent.yaml
  summarizer:
    ref: ./agents/summarizer.agent.yaml
    overrides:
      persona:
        temperature: 0.2

dag:
  nodes:
    - id: analyze
      agentId: analyzer
      type: task
      inputMapping:
        code: "$.input.pullRequestDiff"
    - id: review-security
      agentId: reviewer
      type: task
      inputMapping:
        analysis: "$.nodes.analyze.output"
        focus: "'security'"
    - id: review-performance
      agentId: reviewer
      type: task
      inputMapping:
        analysis: "$.nodes.analyze.output"
        focus: "'performance'"
    - id: summarize
      agentId: summarizer
      type: task
      inputMapping:
        securityReview: "$.nodes.review-security.output"
        performanceReview: "$.nodes.review-performance.output"

  edges:
    - from: analyze
      to: review-security
    - from: analyze
      to: review-performance
    - from: review-security
      to: summarize
    - from: review-performance
      to: summarize

sharedMemory:
  kvStore: in-memory       # or "sqlite" for persistence
  persistent: false

schedule:
  maxDurationMs: 300000    # 5 minutes max

integrations:
  - type: webhook-in
    id: github-pr
    config:
      path: /hooks/github-pr
      method: POST
  - type: webhook-out
    id: notify-slack
    config:
      url: "${SLACK_WEBHOOK_URL}"

inputSchema:
  type: object
  properties:
    pullRequestDiff:
      type: string
  required: [pullRequestDiff]
```

---

## CLI Command Structure

```
matrix init                              # Initialize a new project
matrix init --template <name>            # Init from template

matrix agent create <name>               # Create agent definition (interactive)
matrix agent list                        # List all agent definitions
matrix agent show <id>                   # Show agent details
matrix agent validate <file>             # Validate agent YAML
matrix agent test <id>                   # Run agent in test mode

matrix workflow create <name>            # Create workflow definition
matrix workflow list                     # List all workflows
matrix workflow show <id>                # Show workflow details
matrix workflow validate <file>          # Validate workflow YAML
matrix workflow run <id> [--input file]  # Execute a workflow
matrix workflow status <runId>           # Check run status
matrix workflow pause <runId>            # Pause a running workflow
matrix workflow resume <runId>           # Resume a paused workflow
matrix workflow cancel <runId>           # Cancel a workflow
matrix workflow logs <runId>             # Stream workflow event log
matrix workflow history                  # List past workflow runs

matrix skill list                        # List available skills
matrix skill install <name>             # Install a skill
matrix skill create <name>              # Scaffold a new skill

matrix dev                               # Start dashboard + watch mode (localhost:3000)
matrix dev --port <port>                 # Custom port

matrix config show                       # Show current config
matrix config set <key> <value>          # Set config value
```

---

## Client & Protocol Adapters

### LLM Adapter Pattern (`packages/adapters/src/llm/`)

```typescript
export interface LLMAdapter {
  readonly provider: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
  chatStream(request: ChatRequest): AsyncIterable<ChatStreamChunk>;
  countTokens(text: string): Promise<number>;
}

// Implementations: AnthropicAdapter, OpenCodeAdapter, MiniMaxAdapter, KimiCodingAdapter
```

### External Client Adapter (`packages/adapters/src/clients/`)

```typescript
export interface ClientAdapter {
  readonly clientType: string;
  connect(config: ClientConfig): Promise<void>;
  disconnect(): Promise<void>;
  sendTask(task: AgentTask): Promise<TaskResult>;
  onMessage(handler: (msg: ClientMessage) => void): Unsubscribe;
}

// Implementations: OpenCodeAdapter, ClaudeAdapter, OpenClawAdapter, CoPawAdapter, QClawAdapter
```

### MCP Integration (`packages/mcp/`)

- **MCP Server**: Exposes TheMatrix workflows as MCP tools (run workflow, query status, read memory)
- **MCP Client**: Allows agents to connect to external MCP servers for additional tools

---

## Implementation Phases

### Phase 1: Foundation (packages/types + utils + config + core skeleton)
**Files to create:**
- `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`
- `packages/types/src/` - All type definitions (agent, workflow, skill, memory, event, message)
- `packages/utils/src/` - Logger, ID generation, retry utils
- `packages/config/src/` - YAML parser, Zod schemas, config loader
- `packages/core/src/event/` - EventBus, EventStore (in-memory)

### Phase 2: Agent Runtime
**Files to create:**
- `packages/core/src/agent/` - AgentRuntime, AgentRegistry, AgentLifecycle
- `packages/core/src/memory/` - MemoryManager, KVStore, ConversationHistory
- `packages/core/src/skill/` - SkillLoader, SkillRegistry
- `packages/core/src/tools/` - ToolRegistry, ToolPermission
- `packages/adapters/src/llm/` - Base adapter + Anthropic, OpenCode, MiniMax, KimiCoding implementations

### Phase 3: Workflow Engine
**Files to create:**
- `packages/core/src/workflow/` - WorkflowEngine, DAGExecutor, StateMachineExecutor, WorkflowScheduler
- `packages/core/src/messaging/` - MessageBroker, MessageRouter
- `packages/core/src/memory/vector-memory.ts` - Vector memory support

### Phase 4: CLI
**Files to create:**
- `apps/cli/src/` - All CLI commands (init, agent, workflow, skill, dev, config)
- `apps/cli/src/ui/` - Terminal UI components (spinner, table, prompts)

### Phase 5 & 6 (Deferred - not in this session)
- Dashboard (Next.js web UI)
- MCP server/client, Plugin host
- External client adapters (openclaw, copaw, qclaw)
- Built-in skill packages

---

## Key Design Patterns

| Pattern | Usage |
|---------|-------|
| **Event Sourcing** | All state changes emitted as events, stored for replay/audit |
| **Adapter** | LLM providers, external clients, storage backends |
| **Registry** | Central registries for agents, workflows, skills, tools |
| **Mediator** | EventBus + MessageBroker decouple agent communication |
| **Strategy** | DAGExecutor vs StateMachineExecutor selected by workflow mode |
| **Observer** | Dashboard subscribes to real-time events via WebSocket |
| **Plugin** | PluginHost loads/sandboxes extensions at runtime |
| **Scoped DI** | Each workflow run gets isolated memory/messaging instances |

---

## Verification Plan

1. **Unit tests**: Each package has its own test suite (`vitest`)
   - `pnpm test` at root runs all tests via turborepo
2. **Integration test**: `examples/simple-pipeline/` workflow end-to-end
   - `matrix workflow run simple-pipeline --input examples/simple-pipeline/input.json`
3. **CLI smoke test**: `matrix init`, `matrix agent list`, `matrix workflow validate`
4. **Dashboard**: `matrix dev` starts localhost:3000, verify workflow graph renders
5. **Build**: `pnpm build` succeeds for all packages
