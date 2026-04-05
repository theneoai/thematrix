# TheMatrix Deployment Guide

This guide covers every method of deploying TheMatrix, from local development to
production Kubernetes clusters. TheMatrix is a multi-agent workflow orchestration
system consisting of several core services: a **Gateway** (webhook ingress on
port 3002), a **Monitor** (API + SSE dashboard on port 3001), a **Scheduler**,
and an **Executor** that runs agent tasks.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Local Development Setup](#2-local-development-setup)
3. [Docker Deployment (Single Node)](#3-docker-deployment-single-node)
4. [Docker Compose Cluster Deployment](#4-docker-compose-cluster-deployment)
5. [Kubernetes Deployment](#5-kubernetes-deployment)
6. [Configuration Reference (matrix.config.yaml)](#6-configuration-reference)
7. [Environment Variables](#7-environment-variables)
8. [Health Checks and Monitoring](#8-health-checks-and-monitoring)
9. [Scaling Considerations](#9-scaling-considerations)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Prerequisites

### Required Software

| Software | Minimum Version | Purpose |
|----------|----------------|---------|
| Node.js  | 22+            | Runtime for all services |
| pnpm     | 9.0.0          | Package manager (enabled via corepack) |
| Turbo    | 2.3.0+         | Monorepo build orchestration |
| Docker   | 24+            | Container builds and single-node deployment |
| Docker Compose | 2.20+   | Multi-container local clusters |
| kubectl  | 1.28+          | Kubernetes deployments (production) |

### Enabling pnpm via Corepack

Node.js 22 ships with Corepack. Enable it and pin the pnpm version:

```bash
corepack enable
corepack prepare pnpm@9.0.0 --activate
pnpm --version   # should print 9.0.0
```

### LLM Provider API Keys

You need at least one LLM provider key. Supported providers are OpenAI,
Anthropic, DeepSeek, Moonshot, Qwen, and Ollama (local, no key required). See
[Section 7](#7-environment-variables) for the full list.

---

## 2. Local Development Setup

### Clone and Install

```bash
git clone <repository-url> thematrix
cd thematrix
pnpm install
```

### Build All Packages

The project uses Turborepo. A single command builds every package in dependency
order:

```bash
pnpm build
```

### Run in Development Mode

```bash
pnpm dev
```

This starts all packages in watch mode using Turbo's pipeline.

### Run Tests

```bash
pnpm test
```

### Type Checking and Linting

```bash
pnpm typecheck
pnpm lint
```

### Clean Build Artifacts

```bash
pnpm clean
```

### Start the Server Locally

After building, you can start the server directly via the CLI:

```bash
node apps/cli/dist/index.js server start
```

The Monitor API will listen on port 3001 and the Gateway on port 3002. Create a
`matrix.config.yaml` in the project root (see [Section 6](#6-configuration-reference))
and export the required API key environment variables before starting.

---

## 3. Docker Deployment (Single Node)

### Build the Image

```bash
docker build -t thematrix/server:latest .
```

The Dockerfile uses a two-stage build:

1. **Builder stage** -- installs dependencies with `pnpm install --frozen-lockfile`
   and runs `pnpm build`.
2. **Production stage** -- copies the built output into a clean `node:22-alpine`
   image, exposes ports 3001 and 3002, and creates a `/data` directory for SQLite
   persistence.

### Run with Docker

```bash
docker run -d \
  --name thematrix \
  -p 3001:3001 \
  -p 3002:3002 \
  -v thematrix-data:/data \
  -v $(pwd)/matrix.config.yaml:/app/matrix.config.yaml:ro \
  -e OPENAI_API_KEY="sk-..." \
  -e ANTHROPIC_API_KEY="sk-ant-..." \
  thematrix/server:latest
```

### Run with Docker Compose (Single Node)

The provided `docker-compose.yml` wraps the above into a declarative file. Create
a `.env` file in the project root with your API keys:

```bash
# .env
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
DEEPSEEK_API_KEY=
MOONSHOT_API_KEY=
QWEN_API_KEY=
```

Then start:

```bash
docker compose up -d
```

To also run a local Ollama instance for on-device model inference:

```bash
docker compose --profile local-llm up -d
```

This starts an `ollama/ollama` container on port 11434 alongside the matrix
server.

### Verify the Container

```bash
docker compose ps
curl http://localhost:3001/health
```

---

## 4. Docker Compose Cluster Deployment

The file `docker-compose.cluster.yml` simulates a multi-node cluster with one
**control plane** node and two **worker** nodes.

### Architecture

```
matrix-control (port 3001, 3002)
    |
    +-- matrix-worker-1  (labels: gpu=false, zone=us-east)
    +-- matrix-worker-2  (labels: gpu=false, zone=us-west)
```

The control node runs the full server (Gateway + Monitor + Scheduler). Each
worker registers itself with the control node on startup.

### Start the Cluster

```bash
docker compose -f docker-compose.cluster.yml up -d --build
```

### Key Configuration

Workers connect to the control node via the `--register` flag:

```yaml
command: ["worker", "start", "--register", "http://matrix-control:3001"]
```

Node labels are passed through `MATRIX_NODE_LABELS` and can be used for
task affinity in workflow definitions:

```yaml
environment:
  - MATRIX_NODE_LABELS=gpu=false,zone=us-east
```

### Add More Workers

Duplicate a worker service definition in the compose file, change the service
name and labels, then run:

```bash
docker compose -f docker-compose.cluster.yml up -d --scale matrix-worker-1=3
```

Or add additional named services for heterogeneous configurations.

### Stop the Cluster

```bash
docker compose -f docker-compose.cluster.yml down
```

Add `-v` to also remove the `control-data` volume.

---

## 5. Kubernetes Deployment

The `k8s/` directory contains all manifests needed for a production deployment.
Apply them in the order shown below.

### Step 1: Create the Namespace

```bash
kubectl apply -f k8s/namespace.yaml
```

This creates the `thematrix` namespace with standard Kubernetes labels.

### Step 2: Create Secrets

Create a secret with your LLM provider API keys. This is not included in the
manifests for security reasons -- you must create it manually:

```bash
kubectl create secret generic thematrix-secrets \
  --namespace thematrix \
  --from-literal=openai-api-key="sk-..." \
  --from-literal=anthropic-api-key="sk-ant-..."
```

Add additional keys as needed (e.g., `deepseek-api-key`, `moonshot-api-key`).

### Step 3: Create the ConfigMap

```bash
kubectl apply -f k8s/configmap.yaml
```

The ConfigMap embeds a `matrix.config.yaml` tuned for Kubernetes. Key
differences from the local config:

- `execution.backend` is set to `kubernetes` (not `local`).
- `execution.config.namespace` is set to `thematrix-agents` (the namespace
  where agent Job pods run).
- `execution.parallelism` is raised to `10`.
- The `cluster` section is enabled with `least-loaded` distribution strategy.

### Step 4: Set Up RBAC

```bash
kubectl apply -f k8s/rbac.yaml
```

This creates:

- A `ServiceAccount` named `thematrix`.
- A `Role` named `thematrix-agent-executor` granting permissions to create and
  manage Jobs, read pod logs, and manage ConfigMaps in the namespace.
- A `RoleBinding` linking the two.

### Step 5: Create a PersistentVolumeClaim

The deployment expects a PVC named `thematrix-data`. Create one appropriate for
your cluster's storage class:

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: thematrix-data
  namespace: thematrix
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
EOF
```

Adjust the `storageClassName` field if your cluster requires it.

### Step 6: Deploy the Server

```bash
kubectl apply -f k8s/deployment.yaml
```

The Deployment runs one replica of `thematrix/server:latest` with:

- Resource requests: 500m CPU, 512Mi memory.
- Resource limits: 2 CPU, 2Gi memory.
- Liveness probe: `GET /health` on port 3001 every 30 seconds.
- Readiness probe: `GET /health` on port 3001 every 10 seconds.
- The config is mounted read-only at `/app/matrix.config.yaml`.
- Persistent data is mounted at `/data`.

### Step 7: Expose the Services

```bash
kubectl apply -f k8s/service.yaml
```

Two services are created:

| Service | Type | Port | Purpose |
|---------|------|------|---------|
| `thematrix-monitor` | ClusterIP | 3001 | Internal monitoring API and SSE |
| `thematrix-gateway` | LoadBalancer | 80 -> 3002 | External webhook ingress |

The Gateway service uses `LoadBalancer` type so that external systems (Gerrit,
Jira, GitLab, Feishu) can send webhooks to it.

### Step 8: Verify the Deployment

```bash
kubectl -n thematrix get pods
kubectl -n thematrix get svc
kubectl -n thematrix logs deployment/thematrix-server
```

Check the health endpoint through port-forwarding:

```bash
kubectl -n thematrix port-forward svc/thematrix-monitor 3001:3001
curl http://localhost:3001/health
```

### Step 9: Create the Agent Namespace

If the execution backend targets a separate namespace for agent Jobs, create it:

```bash
kubectl create namespace thematrix-agents
```

Also grant the `thematrix` service account permissions in that namespace if
your RBAC policies require it.

### Agent Job Execution

The file `k8s/job-template.yaml` is a template (not applied directly). The
Kubernetes executor backend uses it at runtime to spawn agent Jobs. Each Job:

- Has a TTL of 3600 seconds after completion (auto-cleanup).
- Has zero retries (`backoffLimit: 0`).
- Has a configurable deadline via `activeDeadlineSeconds`.
- Receives task configuration through environment variables
  (`MATRIX_TASK_ID`, `MATRIX_WORKFLOW_RUN_ID`, `MATRIX_AGENT_CONFIG`,
  `MATRIX_TASK_INPUT`, `MATRIX_CALLBACK_URL`).
- Is labeled with workflow run ID, agent ID, and task ID for easy querying.

---

## 6. Configuration Reference

The main configuration file is `matrix.config.yaml`. It is mounted into the
container at `/app/matrix.config.yaml`.

### providers

Defines LLM provider connections and routing.

```yaml
providers:
  providers:
    - provider: openai            # Provider identifier
      apiKey: ${OPENAI_API_KEY}   # Resolved from environment
      models: [gpt-4o, gpt-4o-mini]
      rateLimit:
        rpm: 500                  # Requests per minute
        tpm: 200000               # Tokens per minute
    - provider: anthropic
      apiKey: ${ANTHROPIC_API_KEY}
      models: [claude-sonnet-4-20250514, claude-haiku-4-5-20251001]
      rateLimit:
        rpm: 300
        tpm: 150000
    - provider: deepseek
      apiKey: ${DEEPSEEK_API_KEY}
      baseUrl: https://api.deepseek.com
      models: [deepseek-chat, deepseek-reasoner]
    - provider: ollama
      baseUrl: http://localhost:11434
      models: [llama3, codellama, qwen2.5-coder]
  failover: true                  # Automatically fail over to next provider
  strategy: priority              # Use providers in declared order
```

Fields per provider:

| Field | Required | Description |
|-------|----------|-------------|
| `provider` | Yes | One of: openai, anthropic, deepseek, moonshot, qwen, ollama |
| `apiKey` | No (ollama) | API key, supports `${ENV_VAR}` syntax |
| `baseUrl` | No | Override the API endpoint |
| `models` | Yes | List of model identifiers to route to this provider |
| `rateLimit.rpm` | No | Max requests per minute |
| `rateLimit.tpm` | No | Max tokens per minute |

Top-level provider settings:

| Field | Default | Description |
|-------|---------|-------------|
| `failover` | false | Try next provider on failure |
| `strategy` | priority | Routing strategy: `priority`, `round-robin`, `least-loaded` |

### tokenPool

Controls token budget enforcement.

```yaml
tokenPool:
  defaultBudget:
    maxTokens: 1000000
    period: daily                 # daily | per-run
    alertThreshold: 0.8           # Alert at 80% usage
  workflowBudgets:
    code-review-pipeline:
      maxTokens: 500000
      maxCostUsd: 5.00
      period: per-run
```

### execution

Configures the agent execution backend.

```yaml
execution:
  backend: local                  # local | kubernetes
  parallelism: 4                  # Max concurrent agent tasks
  config:                         # Only for kubernetes backend
    namespace: thematrix-agents
    image: thematrix/agent-runner:latest
```

### gateway

Webhook ingress configuration.

```yaml
gateway:
  port: 3002
  basePath: /hooks
  channels:
    - platform: gerrit
      enabled: true
      secret: ${GERRIT_WEBHOOK_SECRET}
    - platform: jira
      enabled: true
      secret: ${JIRA_WEBHOOK_SECRET}
    - platform: gitlab
      enabled: true
      secret: ${GITLAB_WEBHOOK_SECRET}
    - platform: feishu
      enabled: true
      config:
        appId: ${FEISHU_APP_ID}
        appSecret: ${FEISHU_APP_SECRET}
        verificationToken: ${FEISHU_VERIFICATION_TOKEN}
    - platform: wechat
      enabled: true
      secret: ${WECHAT_TOKEN}
      config:
        corpId: ${WECHAT_CORP_ID}
        encodingAESKey: ${WECHAT_ENCODING_AES_KEY}
    - platform: custom
      enabled: true
      path: /custom-im
```

Webhook URLs follow the pattern: `http://<host>:3002/hooks/<platform>`

### monitor

```yaml
monitor:
  port: 3001
  enableAlerts: true
  alertRules:
    - id: high-error-rate
      metric: agent.error_rate
      condition:
        operator: gt
        threshold: 0.05
        durationMs: 300000
      severity: critical
      enabled: true
    - id: token-budget-warning
      metric: token.budget_usage
      condition:
        operator: gt
        threshold: 0.8
      severity: warning
      enabled: true
```

### triggers

Map incoming webhook events to workflow executions.

```yaml
triggers:
  - id: gerrit-code-review
    channel: gerrit
    eventType: patchset-created
    conditions:
      - field: "$.change.project"
        operator: matches           # matches | equals | in | contains
        value: "myorg/*"
    workflowId: code-review-pipeline
    inputMapping:
      pullRequestDiff: "$.patchSet.diff"
    enabled: true
    cooldownMs: 10000               # Debounce period
```

### schedules

Cron-based workflow triggers.

```yaml
schedules:
  - id: nightly-quality-scan
    cron: "0 2 * * *"
    timezone: Asia/Shanghai
    workflowId: code-quality-scan
    input:
      repo: "https://github.com/org/repo"
      branch: main
    enabled: true
```

### cluster (Kubernetes only)

```yaml
cluster:
  enabled: true
  distribution:
    strategy: least-loaded        # least-loaded | round-robin
    heartbeatTimeoutMs: 30000
    autoFailover: true
```

---

## 7. Environment Variables

### Core Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | development | Set to `production` for deployments |
| `MATRIX_DATA_DIR` | ./data | Directory for SQLite database and persistence |
| `MATRIX_ROLE` | (none) | Set to `control` or `worker` for cluster mode |
| `MATRIX_NODE_LABELS` | (none) | Comma-separated key=value labels for worker nodes |

### LLM Provider API Keys

| Variable | Provider |
|----------|----------|
| `OPENAI_API_KEY` | OpenAI (GPT-4o, GPT-4o-mini) |
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `DEEPSEEK_API_KEY` | DeepSeek |
| `MOONSHOT_API_KEY` | Moonshot AI |
| `QWEN_API_KEY` | Alibaba Qwen |

Ollama does not require an API key -- just configure `baseUrl` to point at the
Ollama instance.

### Webhook Secrets

| Variable | Platform |
|----------|----------|
| `GERRIT_WEBHOOK_SECRET` | Gerrit |
| `JIRA_WEBHOOK_SECRET` | Jira |
| `GITLAB_WEBHOOK_SECRET` | GitLab |
| `FEISHU_APP_ID` | Feishu (Lark) |
| `FEISHU_APP_SECRET` | Feishu (Lark) |
| `FEISHU_VERIFICATION_TOKEN` | Feishu (Lark) |
| `WECHAT_TOKEN` | WeChat Work |
| `WECHAT_CORP_ID` | WeChat Work |
| `WECHAT_ENCODING_AES_KEY` | WeChat Work |

---

## 8. Health Checks and Monitoring

### Health Endpoint

All deployment methods expose a health check at:

```
GET http://<host>:3001/health
```

Docker Compose uses `wget --spider` against this endpoint every 30 seconds with
3 retries. Kubernetes uses HTTP GET probes:

- **Liveness probe**: checks every 30 seconds after a 10-second initial delay.
  If this fails, the pod is restarted.
- **Readiness probe**: checks every 10 seconds after a 5-second initial delay.
  If this fails, the pod is removed from service endpoints.

### Monitor API

The Monitor service on port 3001 provides:

- Real-time Server-Sent Events (SSE) for workflow and agent status updates.
- REST API for querying workflow runs, agent statuses, and metrics.

### Alert Rules

Alerts are defined in `matrix.config.yaml` under `monitor.alertRules`. Two
default rules are provided:

1. **high-error-rate** (critical) -- fires when `agent.error_rate` exceeds 5%
   for 5 minutes.
2. **token-budget-warning** (warning) -- fires when `token.budget_usage`
   exceeds 80%.

Custom rules follow this schema:

```yaml
- id: <unique-id>
  name: <human-readable name>
  metric: <metric-name>
  condition:
    operator: gt | lt | gte | lte | eq
    threshold: <number>
    durationMs: <sustain-period-ms>   # optional
  severity: critical | warning | info
  enabled: true
```

### Monitoring in Kubernetes

Port-forward the monitor service for local access:

```bash
kubectl -n thematrix port-forward svc/thematrix-monitor 3001:3001
```

To view agent Job execution:

```bash
kubectl -n thematrix get jobs -l app.kubernetes.io/component=agent
kubectl -n thematrix logs job/matrix-agent-<task-id>
```

---

## 9. Scaling Considerations

### Execution Parallelism

The `execution.parallelism` setting controls how many agent tasks run
concurrently. For local/Docker deployments, keep this modest (2-4) to avoid
overwhelming the host. For Kubernetes, this can be raised significantly (10+)
since each agent runs as an isolated Job pod.

### Kubernetes Horizontal Scaling

The control plane server (`thematrix-server` Deployment) is currently configured
with 1 replica. For high availability:

1. Increase `spec.replicas` in `k8s/deployment.yaml`.
2. Ensure the persistence layer supports shared access (switch from
   SQLite/local PVC to a shared database if running multiple replicas).
3. Enable the `cluster` config section with `autoFailover: true`.

### Worker Nodes (Docker Compose Cluster)

In the Docker Compose cluster model, scale by adding worker services or using
`--scale`:

```bash
docker compose -f docker-compose.cluster.yml up -d --scale matrix-worker-1=5
```

Workers self-register with the control node. Use `MATRIX_NODE_LABELS` to
differentiate worker capabilities (e.g., `gpu=true`, `zone=eu-west`).

### Token Budget Scaling

As you add more workflows, adjust `tokenPool` budgets accordingly:

- Set per-workflow budgets under `workflowBudgets` to prevent a single workflow
  from consuming all tokens.
- Set `alertThreshold` to receive warnings before hitting hard limits.
- Use `maxCostUsd` for direct cost control.

### Resource Allocation for Agent Jobs

In Kubernetes, each agent Job's resource requests and limits are set by the
executor at runtime. Ensure your cluster has enough capacity for the configured
`parallelism` level. Consider setting up a dedicated node pool for agent
workloads using labels and node selectors.

---

## 10. Troubleshooting

### Container Fails to Start

**Symptom**: The container exits immediately after starting.

```bash
docker logs thematrix
# or
kubectl -n thematrix logs deployment/thematrix-server
```

Common causes:

- Missing or malformed `matrix.config.yaml`. Ensure the file is mounted
  correctly and is valid YAML.
- Missing required environment variables. Check that at least one LLM provider
  key is set.
- Port conflict. Ensure ports 3001 and 3002 are not in use on the host.

### Health Check Failing

**Symptom**: `curl http://localhost:3001/health` returns an error or times out.

- Verify the server process is running inside the container:
  ```bash
  docker exec thematrix ps aux
  ```
- Check that `monitor.port` in the config matches the exposed port (3001).
- Review the container logs for startup errors.

### Workers Not Registering (Cluster Mode)

**Symptom**: Workers start but do not appear in the control plane.

- Verify network connectivity between workers and the control node:
  ```bash
  docker exec matrix-worker-1 wget -qO- http://matrix-control:3001/health
  ```
- Ensure `MATRIX_ROLE=control` is set on the control node and
  `MATRIX_ROLE=worker` on workers.
- Check that the `--register` URL in the worker command matches the control
  node's service name and port.

### Agent Jobs Not Running (Kubernetes)

**Symptom**: Workflows start but agent tasks remain pending.

- Verify RBAC permissions:
  ```bash
  kubectl -n thematrix auth can-i create jobs --as=system:serviceaccount:thematrix:thematrix
  ```
- Ensure the agent namespace exists:
  ```bash
  kubectl get namespace thematrix-agents
  ```
- Check that the agent runner image is accessible from the cluster:
  ```bash
  kubectl -n thematrix describe job matrix-agent-<task-id>
  ```
  Look for image pull errors in the events.

### Token Budget Exhausted

**Symptom**: Workflows fail with budget-related errors.

- Check current usage via the Monitor API on port 3001.
- Review `tokenPool` settings in `matrix.config.yaml`.
- Increase `maxTokens` or switch `period` from `per-run` to `daily` for more
  flexibility.

### Webhook Events Not Triggering Workflows

- Confirm the external system can reach the Gateway endpoint (port 3002 or
  port 80 via the Kubernetes LoadBalancer).
- Verify the webhook secret matches between the external system and the
  config.
- Check that the trigger's `conditions` match the incoming event payload. Use
  the Monitor API to inspect received events.
- Ensure the trigger's `enabled` field is set to `true`.

### SQLite Database Locked

**Symptom**: Errors mentioning "database is locked" in logs.

- This occurs when multiple processes try to write to the same SQLite file.
  Ensure only one server replica writes to a given `MATRIX_DATA_DIR`.
- In Kubernetes, use `ReadWriteOnce` access mode on the PVC (the default in
  the guide above) and keep replicas at 1 for the control plane, or migrate
  to an external database.

### Resetting State

To fully reset the data directory and start fresh:

```bash
# Docker
docker compose down -v

# Kubernetes
kubectl -n thematrix delete pvc thematrix-data
# Then re-create the PVC and redeploy
```
