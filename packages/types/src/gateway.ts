/**
 * Integration Gateway 类型定义
 *
 * 借鉴 OpenClaw 的 Channel Gateway 模式:
 * 统一的事件接入层，将各平台事件归一化为 TriggerEvent
 */

// ============================================================
// Channel Adapter (平台适配器)
// ============================================================

export type PlatformType =
  | 'gerrit'
  | 'jira'
  | 'gitlab'
  | 'feishu'
  | 'wechat'
  | 'dingtalk'
  | 'slack'
  | 'custom';

export interface ChannelAdapter {
  readonly platform: PlatformType;

  /** 解析平台事件为统一 TriggerEvent */
  parseEvent(req: IncomingRequest): Promise<TriggerEvent | null>;

  /** 验证 Webhook 签名 */
  verifySignature(req: IncomingRequest, secret: string): boolean;

  /** 发送通知到平台 */
  sendNotification(target: NotificationTarget, message: NotificationMessage): Promise<void>;
}

export interface IncomingRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[]>;
  body: unknown;
  query?: Record<string, string>;
  rawBody?: Buffer;
}

// ============================================================
// Trigger Event (归一化事件)
// ============================================================

export interface TriggerEvent {
  id: string;
  platform: PlatformType;
  eventType: string;          // 平台特定: 'patchset-created', 'issue_created', etc.
  source: TriggerEventSource;
  payload: Record<string, unknown>;  // 归一化数据
  rawPayload: unknown;               // 原始平台数据
  timestamp: Date;
  metadata: Record<string, string>;  // 提取的字段，用于触发规则匹配
}

export interface TriggerEventSource {
  project?: string;           // 项目/仓库名
  repository?: string;        // 仓库 URL
  branch?: string;
  author?: string;
  channel?: string;           // IM 频道/群组
}

// ============================================================
// Trigger Rules (触发规则)
// ============================================================

export interface TriggerRule {
  id: string;
  name: string;
  description?: string;
  channel: PlatformType;
  eventType: string;          // 事件类型过滤
  conditions?: TriggerCondition[];
  workflowId: string;         // 触发的工作流
  inputMapping: Record<string, string>;  // 事件字段 → 工作流输入映射 (JSONPath)
  enabled: boolean;
  cooldownMs?: number;        // 冷却时间，防止重复触发
  maxConcurrent?: number;     // 最大并发运行数
}

export interface TriggerCondition {
  field: string;              // JSONPath: "$.change.project"
  operator: 'equals' | 'not_equals' | 'contains' | 'matches' | 'in' | 'gt' | 'lt';
  value: string | string[] | number;
}

// ============================================================
// Cron Schedule
// ============================================================

export interface CronSchedule {
  id: string;
  name: string;
  description?: string;
  cron: string;               // "0 */2 * * *"
  timezone?: string;          // "Asia/Shanghai"
  workflowId: string;
  input?: Record<string, unknown>;
  enabled: boolean;
  maxConcurrent?: number;     // 防止调度重叠
  retryOnFailure?: boolean;
}

// ============================================================
// Notification (出站通知)
// ============================================================

export interface NotificationTarget {
  platform: PlatformType;
  channelId?: string;         // IM 频道/群组 ID
  userId?: string;            // 用户 ID
  webhookUrl?: string;        // Webhook URL
  config?: Record<string, unknown>;
}

export interface NotificationMessage {
  title?: string;
  content: string;
  level: 'info' | 'success' | 'warning' | 'error';
  fields?: NotificationField[];
  actions?: NotificationAction[];
}

export interface NotificationField {
  label: string;
  value: string;
  inline?: boolean;
}

export interface NotificationAction {
  label: string;
  url: string;
  style?: 'primary' | 'danger' | 'default';
}

// ============================================================
// Gateway Config
// ============================================================

export interface GatewayConfig {
  port: number;
  host?: string;
  basePath?: string;          // 默认 "/hooks"
  channels: ChannelConfig[];
  cors?: CorsConfig;
  rateLimit?: GatewayRateLimitConfig;
}

export interface ChannelConfig {
  platform: PlatformType;
  enabled: boolean;
  secret?: string;            // Webhook 签名密钥
  path?: string;              // 自定义路径, 默认 "/<platform>"
  config?: Record<string, unknown>;  // 平台特定配置
}

export interface CorsConfig {
  origins: string[];
  methods?: string[];
}

export interface GatewayRateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

// ============================================================
// Scheduler
// ============================================================

export interface ISchedulerManager {
  addCronJob(schedule: CronSchedule): void;
  removeCronJob(id: string): void;
  addTriggerRule(rule: TriggerRule): void;
  removeTriggerRule(id: string): void;
  listJobs(): CronSchedule[];
  listRules(): TriggerRule[];
  getHistory(limit?: number): ScheduleExecution[];
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface ScheduleExecution {
  id: string;
  scheduleId?: string;
  triggerId?: string;
  workflowRunId: string;
  triggeredAt: Date;
  triggerType: 'cron' | 'event';
  status: 'triggered' | 'running' | 'completed' | 'failed';
  error?: string;
}
