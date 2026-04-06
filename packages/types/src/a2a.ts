/**
 * A2A (Agent-to-Agent) Protocol 类型定义
 *
 * 基于 Google A2A 协议规范, 支持 Agent 间发现、协商和任务委托。
 * 使用 JSON-RPC 2.0 + SSE 流式, 通过 Agent Card 暴露能力。
 */

// ============================================================
// Agent Card (/.well-known/agent.json)
// ============================================================

export interface AgentCard {
  /** Agent 唯一标识 */
  id: string;
  /** 人类可读名称 */
  name: string;
  /** Agent 描述 */
  description: string;
  /** A2A 协议版本 */
  protocolVersion: string;
  /** Agent 端点 URL */
  url: string;
  /** Agent 能力声明 */
  capabilities: AgentCapability[];
  /** 支持的输入内容类型 */
  inputContentTypes: string[];
  /** 支持的输出内容类型 */
  outputContentTypes: string[];
  /** 认证方式 */
  authentication?: AgentAuthentication;
  /** 额外元数据 */
  metadata?: Record<string, unknown>;
}

export interface AgentCapability {
  /** 能力名称 */
  name: string;
  /** 能力描述 */
  description: string;
  /** 输入参数 schema (JSON Schema) */
  inputSchema?: Record<string, unknown>;
  /** 输出参数 schema */
  outputSchema?: Record<string, unknown>;
}

export interface AgentAuthentication {
  /** 认证类型: bearer, api-key, oauth2, none */
  type: 'bearer' | 'api-key' | 'oauth2' | 'none';
  /** 认证配置 */
  config?: Record<string, unknown>;
}

// ============================================================
// A2A 任务生命周期
// ============================================================

export type A2ATaskStatus =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface A2ATask {
  /** 任务 ID */
  taskId: string;
  /** 请求方 Agent ID */
  fromAgentId: string;
  /** 执行方 Agent ID */
  toAgentId: string;
  /** 任务状态 */
  status: A2ATaskStatus;
  /** 任务消息历史 */
  messages: A2AMessage[];
  /** 任务产出物 */
  artifacts?: A2AArtifact[];
  /** 创建时间 */
  createdAt: Date;
  /** 最后更新时间 */
  updatedAt: Date;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

export interface A2AMessage {
  /** 消息角色: 请求方 or 执行方 */
  role: 'requester' | 'executor';
  /** 消息内容 (支持多部分) */
  parts: A2APart[];
  /** 时间戳 */
  timestamp: Date;
}

export type A2APart =
  | { type: 'text'; text: string }
  | { type: 'data'; data: Record<string, unknown>; mimeType?: string }
  | { type: 'file'; uri: string; name: string; mimeType?: string };

export interface A2AArtifact {
  /** 产出物名称 */
  name: string;
  /** 产出物内容 */
  parts: A2APart[];
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

// ============================================================
// A2A JSON-RPC 方法
// ============================================================

/** 发送任务 (一次性) */
export interface A2ASendTaskRequest {
  taskId: string;
  message: A2AMessage;
  /** 可选的推送通知配置 */
  pushNotification?: A2APushNotificationConfig;
}

export interface A2ASendTaskResponse {
  task: A2ATask;
}

/** 获取任务状态 */
export interface A2AGetTaskRequest {
  taskId: string;
}

/** 取消任务 */
export interface A2ACancelTaskRequest {
  taskId: string;
}

/** 推送通知配置 */
export interface A2APushNotificationConfig {
  /** 回调 URL */
  url: string;
  /** 认证信息 */
  authentication?: AgentAuthentication;
}

// ============================================================
// A2A 客户端/服务器接口
// ============================================================

export interface IA2AClient {
  /** 发现远端 Agent */
  discover(url: string): Promise<AgentCard>;
  /** 发送任务给远端 Agent */
  sendTask(agentUrl: string, request: A2ASendTaskRequest): Promise<A2ASendTaskResponse>;
  /** 查询任务状态 */
  getTask(agentUrl: string, taskId: string): Promise<A2ATask>;
  /** 取消任务 */
  cancelTask(agentUrl: string, taskId: string): Promise<A2ATask>;
  /** 流式接收任务更新 (SSE) */
  subscribeTask(agentUrl: string, taskId: string): AsyncIterable<A2ATaskEvent>;
}

export interface IA2AServer {
  /** 启动 A2A 服务 */
  start(): Promise<void>;
  /** 停止 A2A 服务 */
  stop(): Promise<void>;
  /** 注册本地 Agent Card */
  registerAgent(card: AgentCard): void;
  /** 注销 Agent */
  unregisterAgent(agentId: string): void;
  /** 设置任务处理器 */
  setTaskHandler(handler: A2ATaskHandler): void;
}

export type A2ATaskHandler = (task: A2ATask) => Promise<A2ATask>;

export type A2ATaskEvent =
  | { type: 'status-update'; taskId: string; status: A2ATaskStatus }
  | { type: 'artifact-update'; taskId: string; artifact: A2AArtifact }
  | { type: 'message'; taskId: string; message: A2AMessage };

// ============================================================
// Agent Registry (本地 Agent 发现)
// ============================================================

export interface IAgentRegistry {
  /** 注册 Agent Card */
  register(card: AgentCard): void;
  /** 注销 */
  unregister(agentId: string): void;
  /** 按 ID 查找 */
  getById(agentId: string): AgentCard | undefined;
  /** 按能力搜索 */
  findByCapability(capabilityName: string): AgentCard[];
  /** 列出所有 */
  listAll(): AgentCard[];
}
