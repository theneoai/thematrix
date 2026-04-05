/**
 * TheMatrix Core - 核心功能统一导出
 */

// Error handling
export * from './error/index.js';

// Health monitoring
export * from './health/index.js';

// Metrics
export * from './metrics/index.js';

// Event
export * from './event/store.js';
export * from './event/bus.js';

// Memory
export * from './memory/manager.js';
export * from './memory/vector-store.js';
export * from './memory/embeddings.js';
export * from './memory/semantic.js';

// Agent
export * from './agent/registry.js';
export * from './agent/runtime.js';
export * from './agent/loop.js';
export * from './agent/planner.js';
export * from './agent/reflection.js';
export * from './agent/handoff.js';
export * from './agent/blackboard.js';
export * from './agent/context-manager.js';
export * from './agent/trace.js';
export * from './agent/tool-composer.js';

// Guardrails
export * from './guardrails/index.js';
export * from './guardrails/validators.js';

// Messaging
export * from './messaging/broker.js';

// Workflow
export * from './workflow/engine.js';
export * from './workflow/approval.js';
export * from './workflow/dynamic.js';

// Policy
export * from './policy/index.js';

// Environment
export * from './environment/index.js';

// Runtime
export * from './runtime/index.js';
