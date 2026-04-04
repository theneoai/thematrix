# TheMatrix Integration Guide

This guide covers how to connect external platforms to TheMatrix multi-agent cluster system through the gateway, configure trigger rules to dispatch workflows based on incoming events, and set up cron schedules for time-based execution.

---

## Table of Contents

1. [Integration Overview](#integration-overview)
2. [Platform Setup Guides](#platform-setup-guides)
   - [Gerrit](#gerrit)
   - [Jira](#jira)
   - [GitLab](#gitlab)
   - [Feishu (Lark)](#feishu-lark)
   - [WeChat Work](#wechat-work)
   - [DingTalk](#dingtalk)
   - [Slack](#slack)
   - [Custom Webhook](#custom-webhook)
3. [Trigger Rules](#trigger-rules)
4. [Cron Scheduling](#cron-scheduling)
5. [Custom Webhook Integration](#custom-webhook-integration)
6. [Complete Configuration Example](#complete-configuration-example)

---

## Integration Overview

TheMatrix gateway provides 8 platform adapters with bidirectional communication:

- **Inbound**: Each adapter receives webhook payloads from its platform, verifies the request signature, normalizes the payload into a `TriggerEvent`, and forwards it to the scheduler for rule matching.
- **Outbound**: Each adapter can send notifications back to the originating platform (review comments, issue comments, chat messages, etc.) using platform-native formatting.

All adapters implement the `ChannelAdapter` interface with three core methods:

| Method              | Direction | Purpose                                                  |
|---------------------|-----------|----------------------------------------------------------|
| `parseEvent`        | Inbound   | Normalize a raw webhook request into a `TriggerEvent`    |
| `verifySignature`   | Inbound   | Validate request authenticity using platform-specific signing |
| `sendNotification`  | Outbound  | Post a formatted notification back to the platform       |

The webhook URL pattern for all platforms is:

```
https://<gateway-host>/webhook/<platform>
```

where `<platform>` is one of: `gerrit`, `jira`, `gitlab`, `feishu`, `wechat`, `dingtalk`, `slack`, `custom`.

---

## Platform Setup Guides

### Gerrit

**Webhook URL**

```
https://<gateway-host>/webhook/gerrit
```

**Supported Event Types**

| Event              | Description                        |
|--------------------|------------------------------------|
| `patchset-created` | A new patchset is uploaded         |
| `change-merged`    | A change is merged                 |
| `comment-added`    | A comment or review is posted      |

The event type is read from `body.type` or the `x-gerrit-event` header.

**Signature Verification**

- Algorithm: HMAC-SHA256
- Header: `x-gerrit-signature`
- Format: Hex-encoded HMAC digest of the raw request body

**Outbound Notification Format**

Notifications are posted as review comments via the Gerrit REST API:

```
POST /a/changes/{changeId}/revisions/{revisionId}/review
```

The message body is plain text with level prefix, content, fields, and action links.

**Configuration**

```yaml
gateway:
  channels:
    gerrit:
      secret: "your-gerrit-webhook-secret"
      baseUrl: "https://gerrit.example.com"
```

---

### Jira

**Webhook URL**

```
https://<gateway-host>/webhook/jira
```

**Supported Event Types**

| Event                | Description                      |
|----------------------|----------------------------------|
| `jira:issue_created` | A new issue is created           |
| `jira:issue_updated` | An issue is updated (with changelog) |
| `comment_created`    | A comment is added to an issue   |
| `comment_updated`    | A comment is edited              |

The event type is read from the `webhookEvent` field in the request body.

**Signature Verification**

- Algorithm: HMAC-SHA256
- Header: `x-hub-signature`
- Format: `sha256=<hex-digest>` (prefixed)

**Outbound Notification Format**

Notifications are posted as issue comments via the Jira REST API:

```
POST /rest/api/2/issue/{issueKey}/comment
```

The body uses Jira wiki markup with bold labels and link syntax (`[label|url]`). Supports both Basic auth (email + API token) and bearer token authentication.

**Configuration**

```yaml
gateway:
  channels:
    jira:
      secret: "your-jira-webhook-secret"
      baseUrl: "https://yourorg.atlassian.net"
```

---

### GitLab

**Webhook URL**

```
https://<gateway-host>/webhook/gitlab
```

**Supported Event Types**

| Event           | Description                                    |
|-----------------|------------------------------------------------|
| `merge_request` | MR opened, updated, merged, closed             |
| `push`          | Commits pushed to a branch                     |
| `note`          | Comment on MR, issue, commit, or snippet       |
| `pipeline`      | Pipeline status changes                        |

The event type is read from the `x-gitlab-event` header or `object_kind` body field, normalized to lowercase snake_case with trailing `_hook` removed.

**Signature Verification**

- Method: Static token comparison (not HMAC)
- Header: `X-Gitlab-Token`
- The header value is compared directly against the configured secret using timing-safe comparison

**Outbound Notification Format**

Notifications are posted as merge request notes via the GitLab API:

```
POST /api/v4/projects/{projectId}/merge_requests/{mergeRequestIid}/notes
```

The body uses GitLab-flavored Markdown with bold labels and inline links. Authentication uses the `PRIVATE-TOKEN` header.

**Configuration**

```yaml
gateway:
  channels:
    gitlab:
      secret: "your-gitlab-webhook-token"
      baseUrl: "https://gitlab.example.com"
```

---

### Feishu (Lark)

**Webhook URL**

```
https://<gateway-host>/webhook/feishu
```

**Supported Event Types**

| Event                      | Description                        |
|----------------------------|------------------------------------|
| `url_verification`         | Event subscription setup challenge |
| `im.message.receive_v1`   | A message is received by the bot   |
| `card.action.trigger`      | An interactive card action is clicked |

The event type is read from `header.event_type` or `body.event_type` in the Feishu Event API v2 format.

**Signature Verification**

- Algorithm: SHA-256 hash (not HMAC)
- Headers: `x-lark-signature`, `x-lark-request-timestamp`, `x-lark-request-nonce`
- Signature string: `sha256(timestamp + "\n" + nonce + "\n" + secret + "\n" + rawBody)`
- Format: Hex-encoded SHA-256 digest

**Outbound Notification Format**

Notifications are sent as interactive cards to a Feishu webhook URL:

```json
{
  "msg_type": "interactive",
  "card": {
    "header": { "title": { "tag": "plain_text", "content": "..." }, "template": "blue" },
    "elements": [
      { "tag": "markdown", "content": "..." },
      { "tag": "action", "actions": [{ "tag": "button", "text": {...}, "url": "..." }] }
    ]
  }
}
```

Card header colors are mapped from notification level: info=blue, success=green, warning=orange, error=red. Outbound signing is supported by providing a `signingSecret` in the target config.

**Configuration**

```yaml
gateway:
  channels:
    feishu:
      secret: "your-feishu-verification-token"
```

---

### WeChat Work

**Webhook URL**

```
https://<gateway-host>/webhook/wechat
```

**Supported Event Types**

| Event              | Description                                |
|--------------------|--------------------------------------------|
| `url_verification` | Callback URL verification (echostr)        |
| `text`             | Text message received                      |
| `image`            | Image message received                     |
| `event.<Event>`    | Event callbacks (e.g., `event.subscribe`)  |
| `attachment`       | Interactive card callback with actions      |

The event type is derived from `MsgType` (or `msgtype`). For event callbacks, it is composed as `{MsgType}.{Event}`.

**Signature Verification**

- Algorithm: SHA-1
- Parameters: `msg_signature`, `timestamp`, `nonce` (from query string or headers)
- Signature string: Sort `[token, timestamp, nonce]` alphabetically, concatenate, then SHA-1 hash
- Format: Hex-encoded SHA-1 digest compared against `msg_signature`

**Outbound Notification Format**

Notifications are sent as Markdown messages to a WeChat Work bot webhook:

```json
{
  "msgtype": "markdown",
  "markdown": {
    "content": "**[INFO] Title**\nContent\n> Label: <font color=\"info\">value</font>"
  }
}
```

**Configuration**

```yaml
gateway:
  channels:
    wechat:
      secret: "your-wechat-token"
```

---

### DingTalk

**Webhook URL**

```
https://<gateway-host>/webhook/dingtalk
```

**Supported Event Types**

| Event               | Description                          |
|---------------------|--------------------------------------|
| `message.text`      | Text message from a user             |
| `message.richText`  | Rich text message                    |
| `interactive_card`  | Action card button callback          |

The event type is derived from the `msgtype` field. Text and richText messages are prefixed with `message.`. ActionCard callbacks produce the `interactive_card` type.

**Signature Verification**

- Algorithm: HMAC-SHA256
- Parameters: `timestamp` and `sign` (from headers or query string)
- Signature string: `Base64(HMAC-SHA256(timestamp + "\n" + secret, secret))`
- The HMAC key is the secret itself

**Outbound Notification Format**

Notifications are sent as Markdown messages to a DingTalk robot webhook:

```json
{
  "msgtype": "markdown",
  "markdown": {
    "title": "Notification Title",
    "text": "## Title\n\nContent\n\n**Label:** value\n\n[Action](https://...)"
  }
}
```

If a `signingSecret` is configured, the outbound request URL is appended with `timestamp` and `sign` query parameters.

**Configuration**

```yaml
gateway:
  channels:
    dingtalk:
      secret: "your-dingtalk-signing-secret"
```

---

### Slack

**Webhook URL**

```
https://<gateway-host>/webhook/slack
```

**Supported Event Types**

| Event                  | Description                              |
|------------------------|------------------------------------------|
| `url_verification`     | Event subscription URL challenge         |
| `message`              | A message posted in a channel            |
| `app_mention`          | The bot is @mentioned                    |
| `block_actions`        | A user clicks a button or interactive element |
| `interactive_message`  | Legacy interactive message callback      |

Events are read from the Slack Events API `event_callback` wrapper (`event.type` field). Bot messages (`bot_id` or `subtype=bot_message`) are automatically skipped to prevent loops. Replay attacks are rejected if the request timestamp is more than 5 minutes old.

**Signature Verification**

- Algorithm: HMAC-SHA256
- Headers: `X-Slack-Signature`, `X-Slack-Request-Timestamp`
- Signature string: `v0:{timestamp}:{rawBody}`
- Format: `v0=<hex-digest>` (prefixed)

**Outbound Notification Format**

Notifications are sent as Block Kit messages to a Slack incoming webhook:

```json
{
  "blocks": [
    { "type": "header", "text": { "type": "plain_text", "text": ":information_source: Title" } },
    { "type": "section", "text": { "type": "mrkdwn", "text": "Content" } },
    { "type": "section", "fields": [{ "type": "mrkdwn", "text": "*Label:* value" }] },
    { "type": "actions", "elements": [{ "type": "button", "text": {...}, "url": "..." }] },
    { "type": "divider" }
  ],
  "text": "Fallback text for notifications"
}
```

Fields are batched into groups of 10 per section (Slack API limit).

**Configuration**

```yaml
gateway:
  channels:
    slack:
      secret: "your-slack-signing-secret"
```

---

### Custom Webhook

See [Custom Webhook Integration](#custom-webhook-integration) below for full details.

---

## Trigger Rules

Trigger rules define which incoming events should launch workflows, what conditions to filter on, and how to map event data into workflow input.

### Rule Structure

```yaml
triggers:
  - id: "review-on-patchset"
    name: "Run code review on new Gerrit patchset"
    enabled: true
    channel: gerrit
    eventType: "patchset-created"
    conditions:
      - field: "$.branch"
        operator: equals
        value: "main"
    inputMapping:
      changeUrl: "$.changeUrl"
      subject: "$.subject"
      patchsetRef: "$.patchsetRef"
    workflow: "code-review"
    cooldown: 60
    maxConcurrent: 3
```

### Condition Operators

Conditions are evaluated against the normalized event payload. All conditions in a rule must pass (logical AND).

| Operator     | Description                                          | Value Type       |
|--------------|------------------------------------------------------|------------------|
| `equals`     | Exact equality (`===`)                               | any              |
| `not_equals` | Inequality (`!==`)                                   | any              |
| `contains`   | String includes substring, or array includes element | string or array  |
| `matches`    | Regular expression test against a string field       | string (regex)   |
| `in`         | Field value is a member of the provided array        | array            |
| `gt`         | Greater than (numeric fields only)                   | number           |
| `lt`         | Less than (numeric fields only)                      | number           |

For the `matches` operator, the value is a regular expression string. Field values longer than 10,000 characters are rejected as a ReDoS safeguard.

### JSONPath Field Resolution

The `field` property in conditions and `inputMapping` values use a simplified JSONPath dot-notation:

```
$.field.subfield.nested
```

The leading `$.` prefix is optional. Resolution walks the payload object by splitting on `.` and indexing into each level. If any segment is `null` or `undefined`, the resolution returns `undefined`.

Examples:

| Path               | Resolves to                      |
|--------------------|----------------------------------|
| `$.branch`         | `payload.branch`                 |
| `$.status`         | `payload.status`                 |
| `changeUrl`        | `payload.changeUrl`              |
| `$.changes.0.field`| First item's `field` in changes  |

### Input Mapping

The `inputMapping` object defines how event payload fields are mapped into workflow input parameters. Each key is the workflow input parameter name, and each value is a JSONPath expression resolved against the event payload.

```yaml
inputMapping:
  issueKey: "$.issueKey"
  summary: "$.summary"
  priority: "$.priority"
  assignee: "$.assignee"
```

### Cooldown and maxConcurrent

| Setting          | Type   | Description                                                        |
|------------------|--------|--------------------------------------------------------------------|
| `cooldown`       | number | Minimum seconds between consecutive firings of this rule           |
| `maxConcurrent`  | number | Maximum number of concurrent workflow executions for this rule     |

These settings prevent event storms from overwhelming the system. For example, a rapid series of push events can be throttled so only one workflow runs per 60-second window.

---

## Cron Scheduling

The cron scheduler allows workflows to be triggered on a time-based schedule independent of external events.

### Cron Expression Syntax

TheMatrix uses standard 5-field cron expressions:

```
 +------------ minute (0-59)
 | +---------- hour (0-23)
 | | +-------- day of month (1-31)
 | | | +------ month (1-12)
 | | | | +---- day of week (0-6, 0=Sunday)
 | | | | |
 * * * * *
```

Supported syntax in each field:

| Syntax    | Example   | Description                                  |
|-----------|-----------|----------------------------------------------|
| `*`       | `*`       | Every possible value                         |
| Value     | `5`       | Specific value                               |
| Range     | `1-5`     | All values from 1 through 5                  |
| Step      | `*/5`     | Every 5th value starting from the minimum    |
| Range+Step| `1-10/2`  | Every 2nd value from 1 through 10            |
| List      | `1,3,5`   | Specific values 1, 3, and 5                  |

### Timezone Support

Cron schedules support timezone-aware execution via the `timezone` field. The implementation uses `Intl.DateTimeFormat` to resolve wall-clock time in the target timezone before matching against cron fields.

If no timezone is specified, the system uses the server's local time (UTC in most deployments).

Any IANA timezone identifier is supported, for example:
- `America/New_York`
- `Europe/London`
- `Asia/Shanghai`
- `Asia/Tokyo`

### Example Schedules

```yaml
schedules:
  # Every weekday at 9:00 AM Shanghai time
  - id: "daily-standup-report"
    name: "Generate daily standup report"
    cron: "0 9 * * 1-5"
    timezone: "Asia/Shanghai"
    enabled: true
    workflow: "standup-report"
    input:
      team: "platform"

  # Every 15 minutes
  - id: "health-check"
    name: "Run system health check"
    cron: "*/15 * * * *"
    enabled: true
    workflow: "health-check"

  # First day of every month at midnight UTC
  - id: "monthly-metrics"
    name: "Collect monthly metrics"
    cron: "0 0 1 * *"
    enabled: true
    workflow: "monthly-metrics"

  # Every Sunday at 2:00 AM New York time
  - id: "weekly-cleanup"
    name: "Weekly data cleanup"
    cron: "0 2 * * 0"
    timezone: "America/New_York"
    enabled: true
    workflow: "cleanup"
```

---

## Custom Webhook Integration

The custom channel adapter lets you integrate any platform that can send HTTP webhooks, without writing a new adapter. It uses configurable dot-path expressions to extract fields from arbitrary payloads.

### How It Works

1. **Event type extraction**: Configured via `eventTypePath` (e.g., `"action"` or `"event.type"`). If not configured, the adapter probes common field names: `action`, `event`, `type`, `event_type`, `eventType`.

2. **Source field extraction**: Configured via `sourcePaths`. If not configured, the adapter tries common field names like `project`, `repository.name`, `branch`, `author`, `user.name`, `sender`.

3. **Payload extraction**: Configured via `payloadPaths` mapping output keys to dot-paths. If not configured, all top-level body fields are included.

4. **Signature verification**: Supports two modes:
   - `hmac` -- HMAC-based verification with configurable algorithm, header, and prefix
   - `token` -- Simple static token comparison via a configurable header

   If no verification config is provided, the adapter defaults to HMAC-SHA256 with the `x-hub-signature-256` header and `sha256=` prefix (GitHub-compatible).

### Configuration

```yaml
gateway:
  channels:
    custom:
      secret: "your-webhook-secret"
      config:
        eventTypePath: "event.action"
        defaultEventType: "webhook_received"
        sourcePaths:
          project: "repository.full_name"
          branch: "ref"
          author: "sender.login"
        payloadPaths:
          action: "action"
          repoName: "repository.name"
          senderLogin: "sender.login"
          prNumber: "pull_request.number"
          prTitle: "pull_request.title"
        verification:
          type: hmac
          algorithm: sha256
          signatureHeader: "x-hub-signature-256"
          signaturePrefix: "sha256="
        notificationUrl: "https://hooks.example.com/callback"
        notificationHeaders:
          Authorization: "Bearer your-token"
```

### Token-Based Verification Example

For platforms that send a static token rather than an HMAC signature:

```yaml
gateway:
  channels:
    custom:
      secret: "my-static-token-value"
      config:
        verification:
          type: token
          tokenHeader: "x-webhook-token"
```

---

## Complete Configuration Example

The following `matrix.config.yaml` demonstrates a full setup with multiple channels, trigger rules, and cron schedules working together.

```yaml
gateway:
  host: "0.0.0.0"
  port: 8080

  channels:
    gitlab:
      secret: "glwh-s3cret-t0ken"
      baseUrl: "https://gitlab.company.com"

    jira:
      secret: "jira-shared-secret"
      baseUrl: "https://company.atlassian.net"

    slack:
      secret: "xoxb-slack-signing-secret"

    feishu:
      secret: "feishu-verification-token"

    dingtalk:
      secret: "SECdingtalk-signing-secret"

    gerrit:
      secret: "gerrit-hmac-secret"
      baseUrl: "https://gerrit.company.com"

    wechat:
      secret: "wechat-corp-token"

    custom:
      secret: "github-webhook-secret"
      config:
        eventTypePath: "action"
        sourcePaths:
          project: "repository.full_name"
          branch: "ref"
          author: "sender.login"
        payloadPaths:
          action: "action"
          repoName: "repository.name"
          prNumber: "pull_request.number"
          prTitle: "pull_request.title"
          prUrl: "pull_request.html_url"
        verification:
          type: hmac
          algorithm: sha256
          signatureHeader: "x-hub-signature-256"
          signaturePrefix: "sha256="

triggers:
  # Review new GitLab merge requests targeting main
  - id: "gitlab-mr-review"
    name: "Auto-review MR on main"
    enabled: true
    channel: gitlab
    eventType: "merge_request"
    conditions:
      - field: "$.targetBranch"
        operator: equals
        value: "main"
      - field: "$.action"
        operator: in
        value: ["open", "reopen", "update"]
    inputMapping:
      mrUrl: "$.mrUrl"
      mrTitle: "$.mrTitle"
      sourceBranch: "$.sourceBranch"
      diffUrl: "$.diffUrl"
    workflow: "code-review"
    cooldown: 30
    maxConcurrent: 5

  # Triage high-priority Jira issues
  - id: "jira-high-priority-triage"
    name: "Triage high-priority issues"
    enabled: true
    channel: jira
    eventType: "jira:issue_created"
    conditions:
      - field: "$.priority"
        operator: in
        value: ["Critical", "Blocker"]
    inputMapping:
      issueKey: "$.issueKey"
      summary: "$.summary"
      priority: "$.priority"
      description: "$.description"
    workflow: "issue-triage"
    cooldown: 10
    maxConcurrent: 10

  # Respond to Slack mentions
  - id: "slack-mention-handler"
    name: "Handle bot mentions in Slack"
    enabled: true
    channel: slack
    eventType: "app_mention"
    conditions:
      - field: "$.text"
        operator: contains
        value: "help"
    inputMapping:
      text: "$.text"
      channel: "$.channel"
      threadTs: "$.threadTs"
      user: "$.user"
    workflow: "slack-assistant"
    cooldown: 5
    maxConcurrent: 20

  # React to Gerrit code reviews
  - id: "gerrit-review-assist"
    name: "Assist with Gerrit code reviews"
    enabled: true
    channel: gerrit
    eventType: "patchset-created"
    conditions:
      - field: "$.branch"
        operator: matches
        value: "^(main|release/.*)$"
      - field: "$.isDraft"
        operator: equals
        value: false
    inputMapping:
      changeUrl: "$.changeUrl"
      subject: "$.subject"
      project: "$.project"
      patchsetRef: "$.patchsetRef"
    workflow: "gerrit-review"
    cooldown: 60
    maxConcurrent: 3

  # Handle DingTalk messages
  - id: "dingtalk-bot-handler"
    name: "DingTalk bot message handler"
    enabled: true
    channel: dingtalk
    eventType: "message.text"
    inputMapping:
      text: "$.content"
      senderId: "$.senderId"
      senderNick: "$.senderNick"
      sessionWebhook: "$.sessionWebhook"
    workflow: "chat-assistant"
    maxConcurrent: 15

  # GitHub PRs via custom adapter
  - id: "github-pr-review"
    name: "Review GitHub pull requests"
    enabled: true
    channel: custom
    eventType: "opened"
    conditions:
      - field: "$.prNumber"
        operator: gt
        value: 0
    inputMapping:
      prNumber: "$.prNumber"
      prTitle: "$.prTitle"
      prUrl: "$.prUrl"
      repoName: "$.repoName"
    workflow: "github-review"
    cooldown: 30
    maxConcurrent: 5

schedules:
  # Daily standup summary on weekdays
  - id: "daily-standup"
    name: "Generate daily standup summary"
    cron: "0 9 * * 1-5"
    timezone: "Asia/Shanghai"
    enabled: true
    workflow: "standup-report"
    input:
      team: "platform"

  # System health check every 15 minutes
  - id: "health-check"
    name: "Cluster health check"
    cron: "*/15 * * * *"
    enabled: true
    workflow: "health-check"

  # Weekly dependency audit on Sundays
  - id: "dependency-audit"
    name: "Weekly dependency vulnerability scan"
    cron: "0 3 * * 0"
    timezone: "America/New_York"
    enabled: true
    workflow: "dependency-audit"
    input:
      scope: "all"

  # Monthly usage report on the 1st
  - id: "monthly-report"
    name: "Monthly usage and cost report"
    cron: "0 0 1 * *"
    timezone: "UTC"
    enabled: true
    workflow: "monthly-report"
```
