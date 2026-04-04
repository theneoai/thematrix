# TheMatrix Provider Guide

This guide covers configuration, routing, budgeting, and extension of LLM providers in TheMatrix multi-agent cluster system. TheMatrix ships with 14 built-in provider plugins and supports adding custom providers through a plugin interface.

---

## Table of Contents

1. [Supported Providers](#supported-providers)
2. [Provider Configuration](#provider-configuration)
3. [Token Budget Management](#token-budget-management)
4. [Provider Routing Strategies](#provider-routing-strategies)
5. [Secret Management](#secret-management)
6. [Custom Provider Plugins](#custom-provider-plugins)
7. [Cost Tracking and Optimization](#cost-tracking-and-optimization)

---

## Supported Providers

TheMatrix includes 14 built-in providers. The table below lists each provider, its key models, pricing (USD per million tokens), context window, and supported capabilities.

| # | Provider | Plugin Name | Default Model | Models | Context Window | Input $/MT | Output $/MT | Capabilities |
|---|----------|-------------|---------------|--------|----------------|------------|-------------|--------------|
| 1 | **OpenAI** | `openai` | `gpt-4o` | gpt-4o, gpt-4o-mini, o3-mini | 128K-200K | 0.15-2.50 | 0.60-10.00 | chat, tool-calling, vision, streaming, json-mode |
| 2 | **Anthropic** | `anthropic` | `claude-opus-4-5` | claude-opus-4-5, claude-sonnet-4-5, claude-haiku-4-5 | 200K | 0.80-15.00 | 4.00-75.00 | chat, tool-calling, vision, streaming |
| 3 | **Azure OpenAI** | `azure-openai` | `gpt-4o` | gpt-4o, gpt-4o-mini | 128K | -- | -- | chat, tool-calling, vision, streaming |
| 4 | **Google Gemini** | `google-gemini` | `gemini-2.0-flash` | gemini-2.5-pro, gemini-2.0-flash | 1M | 0.10-1.25 | 0.40-10.00 | chat, tool-calling, vision, streaming |
| 5 | **DeepSeek** | `deepseek` | `deepseek-chat` | deepseek-chat (V3), deepseek-reasoner (R1) | 64K | 0.27-0.55 | 1.10-2.19 | chat, tool-calling, streaming, json-mode |
| 6 | **Ollama (Local)** | `ollama` | `llama3` | llama3, llama3:70b, codellama, qwen2.5-coder, deepseek-r1 | 8K-64K | free | free | chat, completion, streaming |
| 7 | **vLLM (Self-hosted)** | `vllm` | `default` | default (user-deployed) | 32K | self-hosted | self-hosted | chat, completion, streaming |
| 8 | **OpenRouter** | `openrouter` | `anthropic/claude-sonnet-4` | claude-sonnet-4, gemini-2.5-pro, llama-3.3-70b (200+ via API) | 128K-1M | varies | varies | chat, tool-calling, streaming |
| 9 | **Moonshot (Kimi)** | `moonshot` | `moonshot-v1-8k` | moonshot-v1-8k, moonshot-v1-32k, moonshot-v1-128k | 8K-128K | 0.80-4.30 | 0.80-4.30 | chat, tool-calling, streaming |
| 10 | **MiniMax** | `minimax` | `abab6.5s-chat` | abab6.5s-chat, abab6.5g-chat | 8K-245K | 0.14-0.70 | 0.14-0.70 | chat, tool-calling, streaming |
| 11 | **Alibaba Qwen** | `qwen` | `qwen-max` | qwen-max, qwen-plus, qwen-turbo, qwen-coder-plus | 32K-131K | 0.04-2.80 | 0.16-11.20 | chat, tool-calling, streaming |
| 12 | **Hugging Face** | `huggingface` | `meta-llama/Llama-3-8b-chat-hf` | Llama-3-8b-chat-hf | 8K | free tier | free tier | chat, streaming |
| 13 | **OpenCode** | `opencode` | `deepseek-chat` | deepseek-chat, qwen-coder-turbo | 64K-131K | 0.27-0.50 | 1.10-2.00 | chat, tool-calling, streaming |
| 14 | **KimiCode** | `kimicode` | `kimi-k2.5` | kimi-k2.5, kimi-k2-thinking, kimi-k2-thinking-turbo, kimi-k2 | 131K-262K | 0.80-1.50 | 3.00-6.00 | chat, tool-calling, streaming |

### Capability Legend

- **chat** -- Standard conversational completions.
- **tool-calling** -- Function/tool invocation support (structured output for agent tool use).
- **vision** -- Accepts image inputs alongside text.
- **streaming** -- Server-sent event streaming for incremental responses.
- **json-mode** -- Guaranteed JSON-structured output.
- **completion** -- Raw text completion (non-chat) endpoint.

---

## Provider Configuration

Each provider is configured in your cluster YAML under the `providers` section. Below are examples for every supported provider.

### OpenAI

```yaml
providers:
  - provider: openai
    apiKey:
      type: env
      ref: OPENAI_API_KEY
    models:
      - gpt-4o
      - gpt-4o-mini
      - o3-mini
```

### Anthropic

```yaml
providers:
  - provider: anthropic
    apiKey:
      type: env
      ref: ANTHROPIC_API_KEY
    baseUrl: https://api.anthropic.com          # optional, this is the default
    models:
      - claude-opus-4-5
      - claude-sonnet-4-5-20250514
      - claude-haiku-4-5-20251001
```

### Azure OpenAI

```yaml
providers:
  - provider: azure-openai
    apiKey:
      type: env
      ref: AZURE_OPENAI_API_KEY
    baseUrl: https://YOUR_RESOURCE.openai.azure.com
    models:
      - gpt-4o
      - gpt-4o-mini
```

### Google Gemini

```yaml
providers:
  - provider: google-gemini
    apiKey:
      type: env
      ref: GOOGLE_API_KEY
    baseUrl: https://generativelanguage.googleapis.com/v1beta/openai  # default
    models:
      - gemini-2.5-pro
      - gemini-2.0-flash
```

### DeepSeek

```yaml
providers:
  - provider: deepseek
    apiKey:
      type: env
      ref: DEEPSEEK_API_KEY
    models:
      - deepseek-chat
      - deepseek-reasoner
```

### Ollama (Local)

```yaml
providers:
  - provider: ollama
    baseUrl: http://localhost:11434             # default
    models:
      - llama3
      - llama3:70b
      - codellama
      - qwen2.5-coder
      - deepseek-r1
```

No API key is needed for Ollama. Ensure the Ollama server is running locally before starting the cluster.

### vLLM (Self-hosted)

```yaml
providers:
  - provider: vllm
    baseUrl: http://localhost:8000              # default
    apiKey: ""                                  # optional, depends on deployment
    models:
      - default
```

Point `baseUrl` to your vLLM deployment. The `default` model ID maps to whatever model is loaded in vLLM.

### OpenRouter

```yaml
providers:
  - provider: openrouter
    apiKey:
      type: env
      ref: OPENROUTER_API_KEY
    models:
      - anthropic/claude-sonnet-4
      - google/gemini-2.5-pro
      - meta-llama/llama-3.3-70b
```

OpenRouter gives access to 200+ models through a single API key. Use the full model slug (e.g., `anthropic/claude-sonnet-4`).

### Moonshot (Kimi)

```yaml
providers:
  - provider: moonshot
    apiKey:
      type: env
      ref: MOONSHOT_API_KEY
    models:
      - moonshot-v1-8k
      - moonshot-v1-32k
      - moonshot-v1-128k
```

### MiniMax

```yaml
providers:
  - provider: minimax
    apiKey:
      type: env
      ref: MINIMAX_API_KEY
    models:
      - abab6.5s-chat
      - abab6.5g-chat
```

### Alibaba Qwen

```yaml
providers:
  - provider: qwen
    apiKey:
      type: env
      ref: DASHSCOPE_API_KEY
    baseUrl: https://dashscope.aliyuncs.com/compatible-mode  # default
    models:
      - qwen-max
      - qwen-plus
      - qwen-turbo
      - qwen-coder-plus
```

### Hugging Face

```yaml
providers:
  - provider: huggingface
    apiKey:
      type: env
      ref: HF_TOKEN
    models:
      - meta-llama/Llama-3-8b-chat-hf
```

### OpenCode

```yaml
providers:
  - provider: opencode
    apiKey:
      type: env
      ref: OPENCODE_API_KEY
    baseUrl: https://your-openai-compatible-endpoint.com  # required
    models:
      - deepseek-chat
      - qwen-coder-turbo
```

OpenCode is a generic adapter for any OpenAI-compatible endpoint. The `baseUrl` field is **required**.

### KimiCode (Moonshot K2)

```yaml
providers:
  - provider: kimicode
    apiKey:
      type: env
      ref: KIMI_API_KEY
    baseUrl: https://api.kimi.com/coding         # default
    models:
      - kimi-k2.5
      - kimi-k2-thinking
      - kimi-k2-thinking-turbo
      - kimi-k2
```

---

## Token Budget Management

TheMatrix uses a `TokenPool` to enforce token budgets, track usage, and rate-limit provider access. Budgets can be scoped to individual agents, entire workflows, or globally.

### Allocation

Budgets are allocated with three scope levels:

| Scope | Description |
|-------|-------------|
| `global` | Cluster-wide budget shared across all agents and workflows. |
| `workflow` | Budget for a single workflow execution. |
| `agent` | Budget for a specific agent within a workflow. |

```yaml
budgets:
  global:
    maxTokens: 10000000
    period: daily
    alertThreshold: 0.8
    providers:
      - openai
      - anthropic

  workflows:
    code-review:
      maxTokens: 500000
      period: per-run

  agents:
    reviewer-agent:
      maxTokens: 100000
      period: per-run
      providers:
        - anthropic
    summarizer-agent:
      maxTokens: 50000
      period: per-run
      providers:
        - deepseek
        - qwen
```

### Budget Fields

| Field | Type | Description |
|-------|------|-------------|
| `maxTokens` | number | Maximum tokens allowed in the period. |
| `period` | string | One of `daily`, `hourly`, `per-run`, or `unlimited`. |
| `alertThreshold` | number (0-1) | Fraction of budget at which a warning callback fires. E.g., `0.8` triggers at 80%. |
| `providers` | string[] | Optional allowlist of provider names. Requests to unlisted providers are rejected. |

### Per-Agent Limits

When an agent exceeds its budget, the `TokenPool` throws an error and fires the `onBudgetExceeded` callback. The agent's request is rejected immediately -- no partial consumption occurs.

```
Token budget exceeded for reviewer-agent: remaining=1200, requested=3500
```

To handle this gracefully, set up callbacks:

```typescript
const pool = new TokenPool({
  onBudgetWarning: (ownerId, usage, budget) => {
    console.log(`Warning: ${ownerId} at ${(usage.totalTokens / budget.maxTokens * 100).toFixed(0)}%`);
  },
  onBudgetExceeded: (ownerId, usage, budget) => {
    console.log(`Budget exceeded for ${ownerId}`);
  },
});
```

### Rate Limiting

Rate limits are set per provider and enforce three constraints within a 1-minute sliding window:

| Parameter | Description |
|-----------|-------------|
| `rpm` | Maximum requests per minute. |
| `tpm` | Maximum tokens per minute. |
| `maxConcurrent` | Maximum concurrent in-flight requests. |

```yaml
rateLimits:
  openai:
    rpm: 60
    tpm: 100000
    maxConcurrent: 10
  anthropic:
    rpm: 50
    tpm: 80000
    maxConcurrent: 8
  deepseek:
    rpm: 30
    tpm: 50000
    maxConcurrent: 5
```

When a provider hits its rate limit, the router skips it and tries the next provider in the failover chain (if failover is enabled). The `canRequest` check happens before every request.

Concurrency is tracked with explicit acquire/release calls:

```typescript
pool.setRateLimit('openai', { rpm: 60, tpm: 100000, maxConcurrent: 10 });

pool.acquireConcurrent('openai');   // call before request
try {
  const result = await adapter.chat(request);
} finally {
  pool.releaseConcurrent('openai'); // call after request completes
}
```

---

## Provider Routing Strategies

The `ProviderRouter` selects which provider handles a given request. It supports four routing strategies configured via the `strategy` field.

### Configuration

```yaml
router:
  strategy: priority          # priority | round-robin | least-cost | least-latency
  failover: true              # try next provider on failure
  providers:
    - provider: anthropic
      apiKey:
        type: env
        ref: ANTHROPIC_API_KEY
    - provider: openai
      apiKey:
        type: env
        ref: OPENAI_API_KEY
    - provider: deepseek
      apiKey:
        type: env
        ref: DEEPSEEK_API_KEY
```

### Strategy: `priority`

The default strategy. The preferred provider (specified by the agent) is tried first. If it fails or is rate-limited, subsequent providers are tried in the order they appear in the `providers` array.

```
Agent requests anthropic -> try anthropic -> (fail) -> try openai -> (fail) -> try deepseek
```

Best for: Production clusters where you have a clear primary provider and want deterministic fallback ordering.

### Strategy: `round-robin`

Distributes requests evenly across all configured providers using an incrementing index. Each new request goes to the next provider in the list, wrapping around.

```
Request 1 -> providers[0]
Request 2 -> providers[1]
Request 3 -> providers[2]
Request 4 -> providers[0]  (wraps around)
```

Best for: Spreading load across multiple provider accounts to stay within per-account rate limits.

### Strategy: `least-cost`

Routes to the cheapest available provider for the requested capability. Falls back to config order if cost data is unavailable.

Best for: Budget-sensitive workloads where response quality is acceptable across providers.

### Strategy: `least-latency`

Routes to the provider with the lowest observed latency. Falls back to config order if latency data is unavailable.

Best for: Latency-critical pipelines such as interactive coding agents.

### Failover Behavior

When `failover: true` is set, the router iterates through the provider list if the current selection fails. Failures include:

- Network errors or timeouts
- Provider API errors (5xx, rate limit 429)
- Rate limit exceeded locally (as tracked by `TokenPool.canRequest()`)

If `failover: false`, the first failure is raised immediately as an error.

```yaml
router:
  strategy: priority
  failover: true    # enable automatic failover
```

### Token Tracking Through the Router

The router wraps every adapter in a `TrackedAdapter` that automatically records token consumption to the `TokenPool` after each request. For non-streaming requests, exact usage is read from the API response. For streaming requests, token counts are estimated at a ratio of approximately 4 characters per token.

---

## Secret Management

TheMatrix uses a `SecretManager` to decouple API key references from their actual values. Secrets are never stored in plain text in configuration files.

### Secret Reference Types

There are three ways to reference a secret:

#### 1. Environment Variable (`env`)

Reads the value from a process environment variable.

```yaml
apiKey:
  type: env
  ref: OPENAI_API_KEY
```

This resolves to `process.env.OPENAI_API_KEY` at runtime.

#### 2. File Reference (`file`)

Reads the value from a file on disk (contents are trimmed of leading/trailing whitespace).

```yaml
apiKey:
  type: file
  ref: /etc/thematrix/secrets/openai-key.txt
```

Useful for Kubernetes secrets mounted as files, or Docker secrets.

#### 3. Vault Reference (`vault`)

Reads the value from a HashiCorp Vault (or compatible) secret store.

```yaml
apiKey:
  type: vault
  ref: secret/data/thematrix/openai
  version: "3"                         # optional version pin
```

Note: Vault integration is a reserved interface. The current implementation will throw an error until a Vault client is configured.

### Inline String Shorthand

For simple cases or local development, you can use a plain string or the `${ENV_VAR}` shorthand:

```yaml
# Direct string (NOT recommended for production)
apiKey: sk-abc123...

# Environment variable shorthand
apiKey: "${OPENAI_API_KEY}"
```

The `${...}` syntax is resolved by calling `SecretManager.resolveValue()`.

### Secret Caching

Resolved secrets are cached for 5 minutes by default to avoid repeated file/vault reads. You can customize the TTL:

```typescript
const secretManager = new SecretManager({ cacheTtlMs: 60_000 }); // 1 minute cache
```

Call `secretManager.clearCache()` to force re-resolution (e.g., after a key rotation).

### Secret Resolution Flow

```
YAML config -> SecretRef { type, ref, version? }
                       |
              SecretManager.resolve()
                       |
        +------+-------+--------+
        |      |                |
       env    file            vault
        |      |                |
  process.env  fs.readFile   vault API
        |      |                |
        +------+-------+--------+
                       |
                   plain string -> RuntimeAuth.token
```

---

## Custom Provider Plugins

To add a provider that is not included in the 14 built-in plugins, implement the `ProviderPlugin` interface and register it.

### Option A: OpenAI-Compatible Provider (Simplest)

If the new provider exposes an OpenAI-compatible `/v1/chat/completions` endpoint, use the factory function:

```typescript
import { createOpenAICompatiblePlugin } from '@thematrix/providers';

export const myProviderPlugin = createOpenAICompatiblePlugin({
  name: 'my-provider',
  displayName: 'My Provider',
  defaultBaseUrl: 'https://api.myprovider.com',
  defaultModel: 'my-model-v1',
  models: [
    {
      id: 'my-model-v1',
      name: 'My Model V1',
      contextWindow: 128000,
      maxOutputTokens: 8192,
      inputPricePerMToken: 1.0,
      outputPricePerMToken: 3.0,
      capabilities: ['chat', 'tool-calling', 'streaming'],
    },
    {
      id: 'my-model-lite',
      name: 'My Model Lite',
      contextWindow: 32768,
      maxOutputTokens: 4096,
      inputPricePerMToken: 0.2,
      outputPricePerMToken: 0.8,
      capabilities: ['chat', 'streaming'],
    },
  ],
});
```

The factory provides a complete plugin with `prepareRuntimeAuth`, `createAdapter`, and `healthCheck` implementations. The adapter handles chat, streaming, tool calling, and token counting out of the box.

### Option B: Fully Custom Provider

For non-OpenAI-compatible APIs (like Anthropic's native format), implement `ProviderPlugin` directly:

```typescript
import type {
  ProviderPlugin,
  ProviderConfig,
  RuntimeAuth,
  HealthStatus,
  ModelInfo,
  LLMAdapter,
} from '@thematrix/types';

export const customPlugin: ProviderPlugin = {
  name: 'custom-provider',
  displayName: 'Custom Provider',
  models: [
    {
      id: 'custom-model',
      name: 'Custom Model',
      contextWindow: 64000,
      maxOutputTokens: 8192,
      inputPricePerMToken: 2.0,
      outputPricePerMToken: 8.0,
      capabilities: ['chat', 'tool-calling', 'streaming'],
    },
  ],

  async prepareRuntimeAuth(config: ProviderConfig): Promise<RuntimeAuth> {
    const apiKey = typeof config.apiKey === 'string' ? config.apiKey : '';
    return {
      provider: 'custom-provider',
      token: apiKey,
      baseUrl: config.baseUrl ?? 'https://api.custom.com',
    };
  },

  createAdapter(auth: RuntimeAuth, model: string): LLMAdapter {
    // Return your custom LLMAdapter implementation
    return new MyCustomAdapter({
      apiKey: auth.token,
      baseUrl: auth.baseUrl,
      model: model || 'custom-model',
    });
  },

  async healthCheck(): Promise<HealthStatus> {
    try {
      const res = await fetch('https://api.custom.com/health', {
        signal: AbortSignal.timeout(5000),
      });
      return {
        provider: 'custom-provider',
        healthy: res.ok,
        checkedAt: new Date(),
        message: res.ok ? 'Reachable' : `Status ${res.status}`,
      };
    } catch (err) {
      return {
        provider: 'custom-provider',
        healthy: false,
        checkedAt: new Date(),
        message: String(err),
      };
    }
  },
};
```

Your `LLMAdapter` must implement these methods:

```typescript
interface LLMAdapter {
  readonly provider: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
  chatStream(request: ChatRequest): AsyncIterable<ChatStreamChunk>;
  countTokens(text: string): Promise<number>;
}
```

### Registering the Plugin

```typescript
import { ProviderRegistry } from '@thematrix/providers';
import { myProviderPlugin } from './my-provider.js';

const registry = new ProviderRegistry();
registry.register(myProviderPlugin);

// Verify registration
console.log(registry.getRegisteredNames());
// => ['my-provider']
```

If you register a plugin with the same name as an existing one, the new plugin overrides the old one (a warning is logged).

### Health Checks

After registration, you can run health checks individually or across all providers:

```typescript
// Single provider
const status = await registry.healthCheck('my-provider');

// All providers
const allStatuses = await registry.healthCheckAll();
allStatuses.forEach(s => {
  console.log(`${s.provider}: ${s.healthy ? 'OK' : 'FAILED'} -- ${s.message}`);
});
```

---

## Cost Tracking and Optimization

TheMatrix tracks costs automatically as part of token consumption. Every request through the `ProviderRouter` is recorded with provider, model, input/output token counts, and estimated cost.

### How Cost Tracking Works

1. The `ProviderRouter` wraps each adapter in a `TrackedAdapter`.
2. After each chat or stream request, the tracker calls `TokenPool.consume()` with a `TokenConsumption` record.
3. The pool updates per-owner usage breakdowns, segmented by provider and model.

### Viewing Usage

```typescript
// Per-agent usage
const usage = pool.getUsage('reviewer-agent');
console.log(`Total tokens: ${usage.totalTokens}`);
console.log(`Total cost:   $${usage.totalCostUsd.toFixed(4)}`);

// Breakdown by provider and model
for (const b of usage.breakdown) {
  console.log(`  ${b.provider}/${b.model}: ${b.requestCount} reqs, ${b.totalTokens} tokens, $${b.costUsd.toFixed(4)}`);
}

// Cluster-wide usage across all budget owners
const allUsage = pool.getGlobalUsage();
```

### Usage Breakdown Fields

Each breakdown entry contains:

| Field | Description |
|-------|-------------|
| `provider` | Provider name (e.g., `openai`). |
| `model` | Model ID (e.g., `gpt-4o`). |
| `inputTokens` | Total input (prompt) tokens consumed. |
| `outputTokens` | Total output (completion) tokens consumed. |
| `totalTokens` | Sum of input and output tokens. |
| `costUsd` | Estimated cost in USD. |
| `requestCount` | Number of requests made. |

### Resetting Usage Counters

For periodic budgets (daily, hourly), reset usage at the start of each period:

```typescript
pool.resetUsage('reviewer-agent');
```

This zeros out `totalTokens`, `totalCostUsd`, and the breakdown array while preserving the budget allocation.

### Cost Optimization Strategies

**1. Use tiered models by task complexity.**

Assign expensive models (claude-opus-4-5, gpt-4o, gemini-2.5-pro) to complex reasoning tasks and cheap models (gpt-4o-mini, deepseek-chat, qwen-turbo, gemini-2.0-flash) to simpler tasks like summarization or formatting.

```yaml
agents:
  architect-agent:
    provider: anthropic
    model: claude-opus-4-5          # complex reasoning
  formatter-agent:
    provider: deepseek
    model: deepseek-chat             # simple formatting, 50x cheaper
```

**2. Use the `least-cost` routing strategy.**

```yaml
router:
  strategy: least-cost
  failover: true
```

This sends requests to the cheapest provider that supports the required capabilities.

**3. Restrict providers per agent.**

Use the budget `providers` allowlist to prevent agents from accidentally using expensive providers.

```yaml
budgets:
  agents:
    utility-agent:
      maxTokens: 200000
      period: daily
      providers:
        - deepseek
        - qwen
        - ollama
```

**4. Set alert thresholds to catch runaway consumption early.**

```yaml
budgets:
  global:
    maxTokens: 5000000
    period: daily
    alertThreshold: 0.5    # warn at 50%
```

**5. Leverage local models for development.**

Use Ollama or vLLM during development to avoid API costs entirely. Switch to cloud providers for production runs.

```yaml
# development profile
providers:
  - provider: ollama
    baseUrl: http://localhost:11434
    models:
      - qwen2.5-coder
      - deepseek-r1
```

**6. Monitor the breakdown to find waste.**

Regularly inspect `pool.getGlobalUsage()` to identify agents that consume disproportionate tokens. Look for high `requestCount` with low value output -- these are candidates for prompt optimization or model downgrade.

### Cost Estimation Formula

For providers that report pricing, cost is computed as:

```
cost = (inputTokens * inputPricePerMToken / 1_000_000)
     + (outputTokens * outputPricePerMToken / 1_000_000)
```

For streaming responses where exact token counts are unavailable, the system estimates at ~4 characters per token.

---

## Quick Reference: Provider Endpoints

| Provider | Default Base URL |
|----------|-----------------|
| OpenAI | `https://api.openai.com` |
| Anthropic | `https://api.anthropic.com` |
| Azure OpenAI | `https://YOUR_RESOURCE.openai.azure.com` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` |
| DeepSeek | `https://api.deepseek.com` |
| Ollama | `http://localhost:11434` |
| vLLM | `http://localhost:8000` |
| OpenRouter | `https://openrouter.ai/api` |
| Moonshot | `https://api.moonshot.cn` |
| MiniMax | `https://api.minimax.chat` |
| Qwen | `https://dashscope.aliyuncs.com/compatible-mode` |
| Hugging Face | `https://api-inference.huggingface.co` |
| OpenCode | (user-specified, required) |
| KimiCode | `https://api.kimi.com/coding` |
