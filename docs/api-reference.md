# TheMatrix API Reference

This document provides a complete reference for the TheMatrix multi-agent cluster system APIs, covering the Monitor REST API, SSE streaming, and Gateway webhook endpoints.

---

## Table of Contents

1. [Monitor REST API](#monitor-rest-api)
   - [Workflows](#workflows)
   - [Agents](#agents)
   - [Tokens](#tokens)
   - [Cluster](#cluster)
   - [Triggers and Schedules](#triggers-and-schedules)
   - [Alerts](#alerts)
   - [Metrics](#metrics)
   - [Health](#health)
2. [SSE Streaming API](#sse-streaming-api)
3. [Gateway Webhook API](#gateway-webhook-api)
4. [Error Response Format](#error-response-format)
5. [Example curl Commands](#example-curl-commands)

---

## Monitor REST API

Base URL: `http://<monitor-host>:<port>`

All REST endpoints return JSON (`Content-Type: application/json`) unless otherwise noted. CORS is enabled for all origins. Only `GET` and `OPTIONS` methods are supported.

### Workflows

#### List Workflow Runs

| Field | Value |
|-------|-------|
| Method | `GET` |
| Path | `/api/workflows` |
| Description | Returns all workflow run summaries. |

**Response** `200 OK`

```json
{
  "workflows": [
    {
      "runId": "run-abc123",
      "workflowId": "wf-deploy-pipeline",
      "status": "completed",
      "startedAt": "2026-04-04T10:00:00.000Z",
      "completedAt": "2026-04-04T10:05:32.000Z",
      "nodeCount": 4
    },
    {
      "runId": "run-def456",
      "workflowId": "wf-code-review",
      "status": "running",
      "startedAt": "2026-04-04T11:20:00.000Z",
      "nodeCount": 2
    }
  ]
}
```

---

#### Get Workflow Run

| Field | Value |
|-------|-------|
| Method | `GET` |
| Path | `/api/workflows/:runId` |
| Description | Returns a single workflow run by its run ID. |

**Path Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `runId` | string | The unique identifier of the workflow run. |

**Response** `200 OK`

```json
{
  "runId": "run-abc123",
  "workflowId": "wf-deploy-pipeline",
  "status": "completed",
  "startedAt": "2026-04-04T10:00:00.000Z",
  "completedAt": "2026-04-04T10:05:32.000Z",
  "nodeCount": 4
}
```

**Response** `404 Not Found`

```json
{
  "error": "Workflow run not found"
}
```

---

#### Get Workflow Events

| Field | Value |
|-------|-------|
| Method | `GET` |
| Path | `/api/workflows/:runId/events` |
| Description | Returns domain events associated with a specific workflow run. |

**Path Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `runId` | string | The unique identifier of the workflow run. |

**Response** `200 OK`

```json
{
  "events": [
    {
      "eventId": "evt-001",
      "type": "workflow.started",
      "source": {
        "kind": "workflow",
        "id": "wf-deploy-pipeline"
      },
      "timestamp": "2026-04-04T10:00:00.000Z",
      "payload": {},
      "correlationId": "run-abc123"
    },
    {
      "eventId": "evt-002",
      "type": "workflow.node.completed",
      "source": {
        "kind": "workflow",
        "id": "wf-deploy-pipeline"
      },
      "timestamp": "2026-04-04T10:01:15.000Z",
      "payload": {},
      "correlationId": "run-abc123"
    }
  ]
}
```

---

### Agents

#### List Agent Instances

| Field | Value |
|-------|-------|
| Method | `GET` |
| Path | `/api/agents` |
| Description | Returns all active agent instance summaries. |

**Response** `200 OK`

```json
{
  "agents": [
    {
      "instanceId": "inst-a1b2c3",
      "agentId": "agent-code-reviewer",
      "status": "running",
      "startedAt": "2026-04-04T09:30:00.000Z",
      "currentTask": "Review PR #42"
    },
    {
      "instanceId": "inst-d4e5f6",
      "agentId": "agent-deployer",
      "status": "idle",
      "startedAt": "2026-04-04T08:00:00.000Z"
    }
  ]
}
```

---

#### Get Agent Instance

| Field | Value |
|-------|-------|
| Method | `GET` |
| Path | `/api/agents/:instanceId` |
| Description | Returns a single agent instance by its instance ID. |

**Path Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `instanceId` | string | The unique identifier of the agent instance. |

**Response** `200 OK`

```json
{
  "instanceId": "inst-a1b2c3",
  "agentId": "agent-code-reviewer",
  "status": "running",
  "startedAt": "2026-04-04T09:30:00.000Z",
  "currentTask": "Review PR #42"
}
```

**Response** `404 Not Found`

```json
{
  "error": "Agent not found"
}
```

---

### Tokens

#### Get Token Usage

| Field | Value |
|-------|-------|
| Method | `GET` |
| Path | `/api/tokens/usage` |
| Description | Returns aggregate token usage and cost breakdown by provider. |

**Response** `200 OK`

```json
{
  "totalTokensUsed": 1520000,
  "totalCost": 24.80,
  "byProvider": {
    "anthropic": {
      "tokens": 1200000,
      "cost": 18.00
    },
    "openai": {
      "tokens": 320000,
      "cost": 6.80
    }
  }
}
```

---

#### Get Token Budget

| Field | Value |
|-------|-------|
| Method | `GET` |
| Path | `/api/tokens/budget/:ownerId` |
| Description | Returns the token budget for a specific owner (team, project, or user). |

**Path Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `ownerId` | string | The budget owner identifier. |

**Response** `200 OK`

```json
{
  "ownerId": "team-platform",
  "limit": 5000000,
  "used": 1520000,
  "remaining": 3480000
}
```

**Response** `404 Not Found`

```json
{
  "error": "Budget not found"
}
```

---

### Cluster

#### List Cluster Nodes

| Field | Value |
|-------|-------|
| Method | `GET` |
| Path | `/api/cluster/nodes` |
| Description | Returns all registered cluster nodes with their current status and load. |

**Response** `200 OK`

```json
{
  "nodes": [
    {
      "nodeId": "node-1",
      "hostname": "worker-01.cluster.local",
      "endpoint": "http://worker-01:8080",
      "backendType": "docker",
      "capabilities": {
        "cpuCores": 16,
        "memoryGb": 64,
        "gpuCount": 2,
        "gpuModel": "NVIDIA A100",
        "maxConcurrentTasks": 8,
        "supportedProviders": ["ollama"],
        "features": ["docker", "gpu", "fast-storage"]
      },
      "status": "online",
      "currentLoad": {
        "activeTasks": 3,
        "cpuUsagePercent": 45.2,
        "memoryUsagePercent": 62.1,
        "gpuUsagePercent": 30.0,
        "networkBandwidthMbps": 120.5,
        "queuedTasks": 1
      },
      "labels": {
        "region": "us-east-1",
        "tier": "gpu"
      },
      "registeredAt": "2026-04-01T00:00:00.000Z",
      "lastHeartbeat": "2026-04-04T12:00:05.000Z"
    }
  ]
}
```

---

#### Get Cluster Health

| Field | Value |
|-------|-------|
| Method | `GET` |
| Path | `/api/cluster/health` |
| Description | Returns aggregated cluster statistics. |

**Response** `200 OK`

```json
{
  "totalNodes": 5,
  "onlineNodes": 4,
  "totalActiveTasks": 12,
  "totalQueuedTasks": 3,
  "avgCpuUsage": 52.3,
  "avgMemoryUsage": 68.7,
  "taskCompletionRate": 0.97
}
```

---

### Triggers and Schedules

#### List Triggers

| Field | Value |
|-------|-------|
| Method | `GET` |
| Path | `/api/triggers` |
| Description | Returns all configured trigger rules. |

**Response** `200 OK`

```json
{
  "triggers": [
    {
      "id": "trig-001",
      "name": "Gerrit Patchset Review",
      "type": "gerrit",
      "enabled": true
    },
    {
      "id": "trig-002",
      "name": "Jira Issue Assignment",
      "type": "jira",
      "enabled": false
    }
  ]
}
```

---

#### List Schedules

| Field | Value |
|-------|-------|
| Method | `GET` |
| Path | `/api/schedules` |
| Description | Returns all configured cron schedules. |

**Response** `200 OK`

```json
{
  "schedules": [
    {
      "id": "sched-001",
      "name": "Nightly Code Scan",
      "cron": "0 2 * * *",
      "enabled": true,
      "lastRunAt": "2026-04-04T02:00:00.000Z",
      "nextRunAt": "2026-04-05T02:00:00.000Z"
    }
  ]
}
```

---

### Alerts

#### List Active Alerts

| Field | Value |
|-------|-------|
| Method | `GET` |
| Path | `/api/alerts` |
| Description | Returns all currently active (firing or acknowledged) alerts. |

**Response** `200 OK`

```json
{
  "alerts": [
    {
      "id": "alert-001",
      "ruleId": "rule-high-error-rate",
      "severity": "critical",
      "title": "High Agent Error Rate",
      "message": "Agent error rate exceeded 5% for 5 minutes",
      "metric": "agent.error_rate",
      "currentValue": 7.2,
      "threshold": 5.0,
      "firedAt": "2026-04-04T11:45:00.000Z",
      "status": "firing"
    }
  ]
}
```

---

#### List Alert Rules

| Field | Value |
|-------|-------|
| Method | `GET` |
| Path | `/api/alerts/rules` |
| Description | Returns all configured alert rules. |

**Response** `200 OK`

```json
{
  "rules": [
    {
      "id": "rule-high-error-rate",
      "name": "High Agent Error Rate",
      "description": "Fires when agent error rate exceeds threshold",
      "metric": "agent.error_rate",
      "condition": {
        "operator": "gt",
        "threshold": 5.0,
        "durationMs": 300000,
        "windowMs": 600000
      },
      "severity": "critical",
      "cooldownMs": 900000,
      "notifyChannels": ["slack-ops"],
      "enabled": true
    }
  ]
}
```

---

### Metrics

#### Get Prometheus Metrics

| Field | Value |
|-------|-------|
| Method | `GET` |
| Path | `/metrics` |
| Description | Returns metrics in Prometheus text exposition format. |

**Response** `200 OK` (`Content-Type: text/plain; charset=utf-8`)

```
# HELP thematrix_agent_tasks_total Total agent tasks processed
# TYPE thematrix_agent_tasks_total counter
thematrix_agent_tasks_total{agent="code-reviewer"} 142
thematrix_agent_tasks_total{agent="deployer"} 87
```

If no metrics provider is configured, returns a comment indicating so.

---

### Health

#### Health Check

| Field | Value |
|-------|-------|
| Method | `GET` |
| Path | `/health` |
| Description | Returns monitor server health status. |

**Response** `200 OK`

```json
{
  "status": "ok",
  "timestamp": "2026-04-04T12:00:00.000Z"
}
```

---

## SSE Streaming API

The SSE (Server-Sent Events) endpoint provides real-time streaming of domain events to connected clients.

### Connection Endpoint

| Field | Value |
|-------|-------|
| Method | `GET` |
| Path | `/api/events/stream` |
| Description | Opens a persistent SSE connection for real-time event streaming. |

**Query Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `types` | string | No | Comma-separated list of event types to subscribe to. If omitted, all events are received. |

**Response Headers**

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
Access-Control-Allow-Origin: *
```

Upon connection, the server sends an initial comment:

```
:connected
```

### Event Format

Each event is sent in standard SSE format with three fields:

```
event: <event-type>
id: <event-id>
data: <json-payload>
```

**Example event:**

```
event: agent.started
id: evt-abc123
data: {"eventId":"evt-abc123","type":"agent.started","source":{"kind":"agent","id":"agent-code-reviewer"},"timestamp":"2026-04-04T10:00:00.000Z","payload":{},"correlationId":"run-abc123"}
```

### Event Types

Events follow the `DomainEvent` schema. The `type` field determines the event category. Available event types include:

| Category | Event Types |
|----------|-------------|
| Agent | `agent.created`, `agent.initialized`, `agent.started`, `agent.turn.started`, `agent.turn.completed`, `agent.paused`, `agent.resumed`, `agent.stopped`, `agent.error` |
| Workflow | `workflow.created`, `workflow.started`, `workflow.node.started`, `workflow.node.completed`, `workflow.node.failed`, `workflow.paused`, `workflow.resumed`, `workflow.completed`, `workflow.failed`, `workflow.cancelled` |
| Trigger | `trigger.received`, `trigger.matched`, `trigger.fired`, `schedule.fired` |
| Token | `token.consumed`, `token.budget.warning`, `token.budget.exceeded` |
| Cluster | `cluster.node.registered`, `cluster.node.deregistered`, `cluster.node.offline`, `cluster.task.distributed` |
| Execution | `execution.started`, `execution.completed`, `execution.failed` |
| Alert | `alert.fired`, `alert.resolved`, `alert.acknowledged` |
| System | `system.error` |

### Subscription Filtering

To receive only specific event types, pass them as a comma-separated `types` query parameter:

```
GET /api/events/stream?types=agent.started,agent.stopped,workflow.completed
```

If the `types` parameter is omitted, the client receives all broadcast events.

### Heartbeat Mechanism

The server sends periodic heartbeat comments to keep connections alive and detect broken clients. The default interval is 30 seconds.

```
:heartbeat
```

Heartbeat messages are SSE comments (prefixed with `:`) and are silently ignored by compliant SSE clients. If the server fails to write a heartbeat, it considers the connection broken and removes it.

### Connection Lifecycle

1. Client opens an HTTP `GET` request to `/api/events/stream`.
2. Server responds with `200` and SSE headers.
3. Server sends `:connected` comment.
4. Server streams matching events as they occur.
5. Server sends `:heartbeat` comments every 30 seconds.
6. Connection closes when the client disconnects or the server shuts down.

---

## Gateway Webhook API

The Gateway server receives incoming webhooks from external platforms and normalizes them into `TriggerEvent` objects for workflow execution.

### Base Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `basePath` | `/hooks` | URL prefix for all webhook endpoints. |
| `host` | `0.0.0.0` | Bind address. |
| `port` | (required) | Listening port. |

### Webhook Receive Endpoint

| Field | Value |
|-------|-------|
| Method | `POST` |
| Path | `{basePath}/{platform}` |
| Description | Receives a webhook payload from the specified platform. |

Only `POST` requests are accepted. All other methods return `405 Method Not Allowed`.

### Per-Platform URL Patterns

The default URL for each platform follows the pattern `{basePath}/{platform}`. A custom path can be configured per channel.

| Platform | Default Path | Full URL Example |
|----------|-------------|------------------|
| Gerrit | `/hooks/gerrit` | `http://gateway:3000/hooks/gerrit` |
| Jira | `/hooks/jira` | `http://gateway:3000/hooks/jira` |
| GitLab | `/hooks/gitlab` | `http://gateway:3000/hooks/gitlab` |
| Feishu | `/hooks/feishu` | `http://gateway:3000/hooks/feishu` |
| WeChat | `/hooks/wechat` | `http://gateway:3000/hooks/wechat` |
| DingTalk | `/hooks/dingtalk` | `http://gateway:3000/hooks/dingtalk` |
| Slack | `/hooks/slack` | `http://gateway:3000/hooks/slack` |
| Custom | `/hooks/custom` | `http://gateway:3000/hooks/custom` |

### Request Format

Webhook requests must have a JSON body (`Content-Type: application/json`). The maximum body size is 10 MB.

If a `secret` is configured for the channel, the server verifies the webhook signature using the platform-specific mechanism (e.g., HMAC header) before processing.

### Response Formats

#### Accepted Event

**Response** `200 OK`

```json
{
  "status": "accepted",
  "eventId": "evt-12345",
  "platform": "gerrit",
  "eventType": "patchset-created"
}
```

#### Ignored Event

Returned when the adapter does not recognize or filters out the event.

**Response** `200 OK`

```json
{
  "status": "ignored",
  "message": "Event not recognized or filtered"
}
```

#### URL Verification Challenge

Some platforms (Feishu, WeChat, Slack) require a verification handshake when registering the webhook URL. The gateway handles this automatically.

**Response** `200 OK`

```json
{
  "challenge": "<challenge-token>"
}
```

#### Signature Verification Failure

**Response** `401 Unauthorized`

```json
{
  "error": "Signature verification failed"
}
```

#### Invalid JSON Body

**Response** `400 Bad Request`

```json
{
  "error": "Invalid JSON body"
}
```

#### Parse Failure

**Response** `400 Bad Request`

```json
{
  "error": "Failed to parse event"
}
```

### Gateway Health Check

| Field | Value |
|-------|-------|
| Method | `GET` |
| Path | `/health` or `{basePath}/health` |
| Description | Returns gateway health status and registered channel list. |

**Response** `200 OK`

```json
{
  "status": "ok",
  "channels": ["/gerrit", "/jira", "/gitlab", "/slack"]
}
```

---

## Error Response Format

All API errors across both the Monitor and Gateway servers follow a consistent JSON structure:

```json
{
  "error": "<error message>"
}
```

### Standard Error Codes

| HTTP Status | Error Message | Condition |
|-------------|---------------|-----------|
| `400` | `Invalid JSON body` / `Failed to parse event` | Malformed request body. |
| `401` | `Signature verification failed` | Webhook signature does not match. |
| `404` | `Not found` | No matching route or resource. |
| `404` | `Workflow run not found` / `Agent not found` / `Budget not found` | Specific resource lookup failed. |
| `405` | `Method not allowed` | Non-POST request to a webhook endpoint. |
| `500` | `Internal server error` | Unhandled exception in a route handler. |
| `501` | `Data provider not configured` | The requested data provider is not registered on the monitor. |

---

## Example curl Commands

### Monitor API

**List all workflow runs:**

```bash
curl -s http://localhost:9100/api/workflows | jq .
```

**Get a specific workflow run:**

```bash
curl -s http://localhost:9100/api/workflows/run-abc123 | jq .
```

**Get events for a workflow run:**

```bash
curl -s http://localhost:9100/api/workflows/run-abc123/events | jq .
```

**List all agents:**

```bash
curl -s http://localhost:9100/api/agents | jq .
```

**Get a specific agent:**

```bash
curl -s http://localhost:9100/api/agents/inst-a1b2c3 | jq .
```

**Get token usage summary:**

```bash
curl -s http://localhost:9100/api/tokens/usage | jq .
```

**Get token budget for an owner:**

```bash
curl -s http://localhost:9100/api/tokens/budget/team-platform | jq .
```

**List cluster nodes:**

```bash
curl -s http://localhost:9100/api/cluster/nodes | jq .
```

**Get cluster health:**

```bash
curl -s http://localhost:9100/api/cluster/health | jq .
```

**List triggers:**

```bash
curl -s http://localhost:9100/api/triggers | jq .
```

**List schedules:**

```bash
curl -s http://localhost:9100/api/schedules | jq .
```

**List active alerts:**

```bash
curl -s http://localhost:9100/api/alerts | jq .
```

**List alert rules:**

```bash
curl -s http://localhost:9100/api/alerts/rules | jq .
```

**Fetch Prometheus metrics:**

```bash
curl -s http://localhost:9100/metrics
```

**Health check:**

```bash
curl -s http://localhost:9100/health | jq .
```

### SSE Streaming

**Subscribe to all events:**

```bash
curl -N http://localhost:9100/api/events/stream
```

**Subscribe to specific event types:**

```bash
curl -N "http://localhost:9100/api/events/stream?types=agent.started,agent.stopped,workflow.completed"
```

### Gateway Webhooks

**Simulate a Gerrit webhook:**

```bash
curl -X POST http://localhost:3000/hooks/gerrit \
  -H "Content-Type: application/json" \
  -d '{
    "type": "patchset-created",
    "change": {
      "project": "my-repo",
      "branch": "main",
      "number": 12345
    },
    "patchSet": {
      "number": 1,
      "ref": "refs/changes/45/12345/1"
    }
  }'
```

**Gateway health check:**

```bash
curl -s http://localhost:3000/health | jq .
```
