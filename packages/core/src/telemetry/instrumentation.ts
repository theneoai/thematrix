/**
 * Telemetry Instrumentation - 自动为 Agent/Workflow 执行添加追踪
 *
 * 提供装饰器风格的包装函数, 将 OpenTelemetry span 注入到:
 * - Agent turn 执行
 * - LLM 调用
 * - Tool 调用
 * - Workflow 节点执行
 * - Memory 操作
 */
import type {
  ITelemetryProvider,
  ITelemetrySpan,
} from '@thematrix/types';
import {
  TelemetryAttributes as Attr,
  TelemetrySpanNames as SpanName,
} from '@thematrix/types';
import { Logger } from '@thematrix/utils';

const logger = new Logger({ prefix: 'TelemetryInstrumentation' });

/**
 * 为 Agent Turn 创建追踪 span
 */
export function traceAgentTurn(
  telemetry: ITelemetryProvider,
  agentId: string,
  agentName: string,
  model: string,
  provider: string,
): ITelemetrySpan {
  return telemetry.startSpan(SpanName.AGENT_TURN, {
    kind: 'internal',
    attributes: {
      [Attr.AGENT_ID]: agentId,
      [Attr.AGENT_NAME]: agentName,
      [Attr.AGENT_MODEL]: model,
      [Attr.AGENT_PROVIDER]: provider,
    },
  });
}

/**
 * 为 LLM 调用创建追踪 span
 */
export function traceLLMCall(
  telemetry: ITelemetryProvider,
  model: string,
  system: string,
): ITelemetrySpan {
  return telemetry.startSpan(SpanName.LLM_CALL, {
    kind: 'client',
    attributes: {
      [Attr.LLM_MODEL]: model,
      [Attr.LLM_SYSTEM]: system,
    },
  });
}

/**
 * 记录 LLM 调用的 token 使用情况到 span
 */
export function recordLLMTokenUsage(
  span: ITelemetrySpan,
  inputTokens: number,
  outputTokens: number,
): void {
  span.setAttributes({
    [Attr.LLM_INPUT_TOKENS]: inputTokens,
    [Attr.LLM_OUTPUT_TOKENS]: outputTokens,
    [Attr.LLM_TOTAL_TOKENS]: inputTokens + outputTokens,
  });
}

/**
 * 为 Tool 调用创建追踪 span
 */
export function traceToolCall(
  telemetry: ITelemetryProvider,
  toolName: string,
): ITelemetrySpan {
  return telemetry.startSpan(SpanName.TOOL_CALL, {
    kind: 'internal',
    attributes: {
      [Attr.TOOL_NAME]: toolName,
    },
  });
}

/**
 * 为 Workflow 节点创建追踪 span
 */
export function traceWorkflowNode(
  telemetry: ITelemetryProvider,
  workflowId: string,
  runId: string,
  nodeId: string,
): ITelemetrySpan {
  return telemetry.startSpan(SpanName.WORKFLOW_NODE, {
    kind: 'internal',
    attributes: {
      [Attr.WORKFLOW_ID]: workflowId,
      [Attr.WORKFLOW_RUN_ID]: runId,
      [Attr.WORKFLOW_NODE_ID]: nodeId,
    },
  });
}

/**
 * 为 Agent Loop 创建追踪 span
 */
export function traceAgentLoop(
  telemetry: ITelemetryProvider,
  agentId: string,
  executionMode: string,
): ITelemetrySpan {
  return telemetry.startSpan(SpanName.AGENT_LOOP, {
    kind: 'internal',
    attributes: {
      [Attr.AGENT_ID]: agentId,
      [Attr.AGENT_EXECUTION_MODE]: executionMode,
    },
  });
}

/**
 * 为 Guardrail 检查创建追踪 span
 */
export function traceGuardrailCheck(
  telemetry: ITelemetryProvider,
  guardrailId: string,
  guardrailType: string,
): ITelemetrySpan {
  return telemetry.startSpan(SpanName.GUARDRAIL_CHECK, {
    kind: 'internal',
    attributes: {
      [Attr.GUARDRAIL_ID]: guardrailId,
      [Attr.GUARDRAIL_TYPE]: guardrailType,
    },
  });
}

/**
 * 包装异步函数以自动追踪
 */
export async function withTrace<T>(
  telemetry: ITelemetryProvider,
  spanName: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: ITelemetrySpan) => Promise<T>,
): Promise<T> {
  return telemetry.withSpan(spanName, async (span) => {
    span.setAttributes(attributes);
    return fn(span);
  });
}
