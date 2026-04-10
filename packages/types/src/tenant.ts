/**
 * Multi-Tenant Types — Organization / Team / Project hierarchy
 *
 * TheMatrix multi-tenancy model:
 *
 *   Organization
 *     └── Team(s)
 *           └── Project(s)
 *                 └── Resources (agents, workflows, eval suites, …)
 *
 * Access is governed by role-based access control (RBAC).
 * Each level inherits from the level above unless overridden.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Identifiers & shared primitives
// ─────────────────────────────────────────────────────────────────────────────

export type TenantId = string;
export type OrgId = string;
export type TeamId = string;
export type ProjectId = string;
export type UserId = string;

/** ISO 8601 timestamp string */
export type ISODateString = string;

/** Billing plan tier */
export type BillingPlan = 'free' | 'starter' | 'pro' | 'enterprise';

/** Membership status across all hierarchy levels */
export type MembershipStatus = 'active' | 'invited' | 'suspended' | 'removed';

// ─────────────────────────────────────────────────────────────────────────────
// RBAC Roles
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Organization-level roles.
 * Roles are hierarchical: owner > admin > billing > member.
 */
export type OrgRole = 'owner' | 'admin' | 'billing' | 'member';

/**
 * Team-level roles.
 * Team lead can manage team members and projects within the team.
 */
export type TeamRole = 'lead' | 'member' | 'viewer';

/**
 * Project-level roles.
 * Controls access to agents, workflows, evals and data within a project.
 */
export type ProjectRole = 'manager' | 'developer' | 'analyst' | 'viewer';

/** Union of all role types (for generic permission checks). */
export type AnyRole = OrgRole | TeamRole | ProjectRole;

// ─────────────────────────────────────────────────────────────────────────────
// Organization
// ─────────────────────────────────────────────────────────────────────────────

export interface Organization {
  id: OrgId;
  name: string;
  slug: string;
  plan: BillingPlan;
  /** Primary contact email */
  contactEmail: string;
  /** Optional custom domain for SSO / branding */
  domain?: string;
  /** Org-level feature flags */
  features: OrgFeatureFlags;
  /** Resource usage limits for this org */
  limits: OrgLimits;
  /** Current resource usage snapshot */
  usage?: OrgUsage;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  /** Soft-delete timestamp */
  deletedAt?: ISODateString;
  metadata?: Record<string, unknown>;
}

export interface OrgFeatureFlags {
  /** Enable multi-team support (pro+) */
  multiTeam: boolean;
  /** Enable SSO integration */
  sso: boolean;
  /** Enable audit logging */
  auditLog: boolean;
  /** Enable custom LLM provider integration */
  customProviders: boolean;
  /** Enable eval regression tracking */
  evalRegression: boolean;
  /** Enable A/B prompt experiments */
  promptExperiments: boolean;
  /** Enable cognitive memory */
  cognitiveMemory: boolean;
}

export interface OrgLimits {
  maxTeams: number;
  maxProjects: number;
  maxMembers: number;
  maxAgents: number;
  maxWorkflowRunsPerDay: number;
  /** Max token consumption per calendar month */
  maxTokensPerMonth: number;
  /** Max API keys that can be issued */
  maxApiKeys: number;
  /** Data retention in days */
  dataRetentionDays: number;
}

export interface OrgUsage {
  /** As of this date */
  asOf: ISODateString;
  teamCount: number;
  projectCount: number;
  memberCount: number;
  agentCount: number;
  workflowRunsToday: number;
  tokensThisMonth: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Organization Membership
// ─────────────────────────────────────────────────────────────────────────────

export interface OrgMember {
  orgId: OrgId;
  userId: UserId;
  role: OrgRole;
  status: MembershipStatus;
  /** When the invitation was accepted */
  joinedAt?: ISODateString;
  invitedBy?: UserId;
  createdAt: ISODateString;
}

// ─────────────────────────────────────────────────────────────────────────────
// Team
// ─────────────────────────────────────────────────────────────────────────────

export interface Team {
  id: TeamId;
  orgId: OrgId;
  name: string;
  slug: string;
  description?: string;
  /** Avatar/icon URL */
  avatarUrl?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt?: ISODateString;
  metadata?: Record<string, unknown>;
}

export interface TeamMember {
  teamId: TeamId;
  userId: UserId;
  role: TeamRole;
  status: MembershipStatus;
  joinedAt?: ISODateString;
  invitedBy?: UserId;
  createdAt: ISODateString;
}

// ─────────────────────────────────────────────────────────────────────────────
// Project
// ─────────────────────────────────────────────────────────────────────────────

export interface Project {
  id: ProjectId;
  orgId: OrgId;
  /** Projects may belong to one team, or be org-level (no team). */
  teamId?: TeamId;
  name: string;
  slug: string;
  description?: string;
  /** Project-level overrides for LLM provider config */
  defaultModel?: ProjectModelConfig;
  /** Project-level token budget */
  tokenBudget?: ProjectTokenBudget;
  /** Project-level environment (dev/staging/prod) */
  environment: 'development' | 'staging' | 'production';
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt?: ISODateString;
  metadata?: Record<string, unknown>;
}

export interface ProjectModelConfig {
  provider: string;
  model: string;
  /** Max tokens per LLM call */
  maxTokens?: number;
  /** Temperature override */
  temperature?: number;
}

export interface ProjectTokenBudget {
  /** Max tokens per day across all agents in this project */
  maxDailyTokens: number;
  /** Hard stop or just alert when exceeded */
  onExceed: 'block' | 'alert';
}

export interface ProjectMember {
  projectId: ProjectId;
  userId: UserId;
  role: ProjectRole;
  status: MembershipStatus;
  joinedAt?: ISODateString;
  invitedBy?: UserId;
  createdAt: ISODateString;
}

// ─────────────────────────────────────────────────────────────────────────────
// Resource Ownership — attaches any resource to a project/org
// ─────────────────────────────────────────────────────────────────────────────

export type ResourceKind =
  | 'agent'
  | 'workflow'
  | 'eval-suite'
  | 'api-key'
  | 'provider'
  | 'skill'
  | 'prompt-version';

export interface ResourceRef {
  kind: ResourceKind;
  id: string;
  orgId: OrgId;
  projectId?: ProjectId;
  /** Who created the resource */
  createdBy: UserId;
  createdAt: ISODateString;
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit Log
// ─────────────────────────────────────────────────────────────────────────────

export type AuditAction =
  | 'org.created'
  | 'org.updated'
  | 'org.deleted'
  | 'team.created'
  | 'team.updated'
  | 'team.deleted'
  | 'project.created'
  | 'project.updated'
  | 'project.deleted'
  | 'member.invited'
  | 'member.removed'
  | 'member.role_changed'
  | 'api_key.created'
  | 'api_key.revoked'
  | 'agent.deployed'
  | 'agent.deleted'
  | 'workflow.run_started'
  | 'workflow.run_completed'
  | 'workflow.run_failed'
  | 'eval.suite_run'
  | 'settings.changed';

export interface AuditLogEntry {
  id: string;
  orgId: OrgId;
  /** Who performed the action */
  actorId: UserId;
  /** Actor's email at the time of the event */
  actorEmail?: string;
  action: AuditAction;
  /** Target resource (e.g. { kind: 'agent', id: 'agent-123' }) */
  target?: { kind: ResourceKind; id: string };
  /** IP address of the request */
  ipAddress?: string;
  /** User-Agent string */
  userAgent?: string;
  /** Free-form details about the event */
  details?: Record<string, unknown>;
  timestamp: ISODateString;
}

// ─────────────────────────────────────────────────────────────────────────────
// Invitation
// ─────────────────────────────────────────────────────────────────────────────

export interface Invitation {
  id: string;
  orgId: OrgId;
  teamId?: TeamId;
  projectId?: ProjectId;
  email: string;
  role: AnyRole;
  token: string;
  expiresAt: ISODateString;
  acceptedAt?: ISODateString;
  revokedAt?: ISODateString;
  invitedBy: UserId;
  createdAt: ISODateString;
}

// ─────────────────────────────────────────────────────────────────────────────
// RBAC helpers (type-level only)
// ─────────────────────────────────────────────────────────────────────────────

/** Role hierarchy levels (higher = more privilege). */
export const ORG_ROLE_LEVELS: Record<OrgRole, number> = {
  member: 0,
  billing: 1,
  admin: 2,
  owner: 3,
};

export const TEAM_ROLE_LEVELS: Record<TeamRole, number> = {
  viewer: 0,
  member: 1,
  lead: 2,
};

export const PROJECT_ROLE_LEVELS: Record<ProjectRole, number> = {
  viewer: 0,
  analyst: 1,
  developer: 2,
  manager: 3,
};

/** Returns true if `actual` org role has at least the privilege of `required`. */
export function hasOrgRole(actual: OrgRole, required: OrgRole): boolean {
  return ORG_ROLE_LEVELS[actual] >= ORG_ROLE_LEVELS[required];
}

/** Returns true if `actual` team role has at least the privilege of `required`. */
export function hasTeamRole(actual: TeamRole, required: TeamRole): boolean {
  return TEAM_ROLE_LEVELS[actual] >= TEAM_ROLE_LEVELS[required];
}

/** Returns true if `actual` project role has at least the privilege of `required`. */
export function hasProjectRole(actual: ProjectRole, required: ProjectRole): boolean {
  return PROJECT_ROLE_LEVELS[actual] >= PROJECT_ROLE_LEVELS[required];
}

// ─────────────────────────────────────────────────────────────────────────────
// Default plan limits
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_PLAN_LIMITS: Record<BillingPlan, OrgLimits> = {
  free: {
    maxTeams: 1,
    maxProjects: 3,
    maxMembers: 5,
    maxAgents: 10,
    maxWorkflowRunsPerDay: 100,
    maxTokensPerMonth: 1_000_000,
    maxApiKeys: 5,
    dataRetentionDays: 30,
  },
  starter: {
    maxTeams: 3,
    maxProjects: 10,
    maxMembers: 25,
    maxAgents: 50,
    maxWorkflowRunsPerDay: 1_000,
    maxTokensPerMonth: 10_000_000,
    maxApiKeys: 20,
    dataRetentionDays: 90,
  },
  pro: {
    maxTeams: 20,
    maxProjects: 100,
    maxMembers: 200,
    maxAgents: 500,
    maxWorkflowRunsPerDay: 10_000,
    maxTokensPerMonth: 100_000_000,
    maxApiKeys: 100,
    dataRetentionDays: 365,
  },
  enterprise: {
    maxTeams: Infinity,
    maxProjects: Infinity,
    maxMembers: Infinity,
    maxAgents: Infinity,
    maxWorkflowRunsPerDay: Infinity,
    maxTokensPerMonth: Infinity,
    maxApiKeys: Infinity,
    dataRetentionDays: Infinity,
  },
};
