/**
 * GitLab Channel Adapter
 *
 * Handles GitLab webhook events and normalizes them into TriggerEvents.
 * Supports: merge_request, push, note, pipeline
 */

import { timingSafeEqual } from 'node:crypto';
import type {
  ChannelAdapter,
  IncomingRequest,
  NotificationMessage,
  NotificationTarget,
  TriggerEvent,
  TriggerEventSource,
} from '@thematrix/types';
import { Logger } from '@thematrix/utils';
import { createTriggerEvent } from '../normalizer.js';

export class GitLabChannelAdapter implements ChannelAdapter {
  readonly platform = 'gitlab' as const;
  private readonly logger: Logger;
  private readonly baseUrl?: string;

  constructor(config?: Record<string, unknown>) {
    this.logger = new Logger({ prefix: 'gateway:gitlab' });
    this.baseUrl = (config?.baseUrl as string) ?? undefined;
  }

  async parseEvent(req: IncomingRequest): Promise<TriggerEvent | null> {
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object') {
      this.logger.warn('Received empty or non-object body');
      return null;
    }

    const eventType = (req.headers['x-gitlab-event'] as string)
      ?? (body.object_kind as string);

    if (!eventType) {
      this.logger.warn('Missing event type in x-gitlab-event header or object_kind');
      return null;
    }

    // Normalize event type to lowercase snake_case
    const normalizedEventType = eventType
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/_hook$/, '');

    const source = this.extractSource(normalizedEventType, body);
    const payload = this.extractPayload(normalizedEventType, body);

    this.logger.info(`Parsed GitLab event: ${normalizedEventType} for ${source.project ?? 'unknown'}`);

    return createTriggerEvent('gitlab', normalizedEventType, source, payload, body);
  }

  verifySignature(req: IncomingRequest, secret: string): boolean {
    // GitLab uses a simple token comparison via X-Gitlab-Token header
    const token = req.headers['x-gitlab-token'] as string | undefined;
    if (!token) {
      this.logger.warn('Missing X-Gitlab-Token header');
      return false;
    }

    // Use timing-safe comparison to prevent timing attacks
    try {
      const tokenBuf = Buffer.from(token);
      const secretBuf = Buffer.from(secret);
      if (tokenBuf.length !== secretBuf.length) return false;
      return timingSafeEqual(tokenBuf, secretBuf);
    } catch {
      return false;
    }
  }

  async sendNotification(target: NotificationTarget, message: NotificationMessage): Promise<void> {
    const gitlabUrl = (target.config?.gitlabUrl as string) ?? this.baseUrl;
    if (!gitlabUrl) {
      throw new Error('GitLab base URL not configured');
    }

    const projectId = target.config?.projectId as string | number;
    const mergeRequestIid = target.config?.mergeRequestIid as number;
    if (!projectId || !mergeRequestIid) {
      throw new Error('projectId and mergeRequestIid are required in notification target config');
    }

    const url = `${gitlabUrl}/api/v4/projects/${encodeURIComponent(String(projectId))}/merge_requests/${mergeRequestIid}/notes`;

    const commentBody = this.formatNotificationMessage(message);

    this.logger.info(`Sending comment to GitLab MR !${mergeRequestIid} in project ${projectId}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'PRIVATE-TOKEN': (target.config?.privateToken as string) ?? '',
      },
      body: JSON.stringify({ body: commentBody }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitLab API error: ${response.status} ${text}`);
    }
  }

  private extractSource(eventType: string, body: Record<string, unknown>): TriggerEventSource {
    const project = body.project as Record<string, unknown> | undefined;
    const user = body.user as Record<string, unknown> | undefined;
    const objectAttrs = body.object_attributes as Record<string, unknown> | undefined;

    let branch: string | undefined;
    if (eventType === 'push') {
      const ref = body.ref as string | undefined;
      branch = ref?.replace('refs/heads/', '');
    } else if (eventType === 'merge_request') {
      branch = objectAttrs?.source_branch as string | undefined;
    }

    return {
      project: (project?.path_with_namespace as string) ?? (project?.name as string) ?? undefined,
      repository: (project?.git_http_url as string) ?? (project?.web_url as string) ?? undefined,
      branch,
      author: (user?.name as string) ?? (user?.username as string) ?? undefined,
    };
  }

  private extractPayload(eventType: string, body: Record<string, unknown>): Record<string, unknown> {
    const project = body.project as Record<string, unknown> | undefined;
    const objectAttrs = body.object_attributes as Record<string, unknown> | undefined;

    const payload: Record<string, unknown> = {
      eventType,
      projectId: project?.id,
      projectName: project?.path_with_namespace,
      projectUrl: project?.web_url,
    };

    switch (eventType) {
      case 'merge_request': {
        payload.action = objectAttrs?.action;
        payload.mrIid = objectAttrs?.iid;
        payload.mrTitle = objectAttrs?.title;
        payload.mrDescription = objectAttrs?.description;
        payload.mrState = objectAttrs?.state;
        payload.sourceBranch = objectAttrs?.source_branch;
        payload.targetBranch = objectAttrs?.target_branch;
        payload.mrUrl = objectAttrs?.url;
        payload.diffUrl = objectAttrs?.url ? `${objectAttrs.url}/diffs` : undefined;
        payload.authorName = (objectAttrs?.last_commit as Record<string, unknown>)?.author
          ? ((objectAttrs?.last_commit as Record<string, unknown>).author as Record<string, unknown>).name
          : undefined;
        break;
      }

      case 'push': {
        const ref = body.ref as string | undefined;
        payload.branch = ref?.replace('refs/heads/', '');
        payload.before = body.before;
        payload.after = body.after;
        payload.totalCommitsCount = body.total_commits_count;
        const commits = body.commits as Array<Record<string, unknown>> | undefined;
        if (commits?.length) {
          payload.commits = commits.map((c) => ({
            id: c.id,
            message: c.message,
            url: c.url,
            author: (c.author as Record<string, unknown>)?.name,
          }));
        }
        break;
      }

      case 'note': {
        payload.noteType = objectAttrs?.noteable_type;
        payload.noteBody = objectAttrs?.note;
        payload.noteUrl = objectAttrs?.url;
        payload.noteableId = objectAttrs?.noteable_id;
        break;
      }

      case 'pipeline': {
        payload.pipelineId = objectAttrs?.id;
        payload.pipelineStatus = objectAttrs?.status;
        payload.pipelineRef = objectAttrs?.ref;
        payload.pipelineSource = objectAttrs?.source;
        const builds = body.builds as Array<Record<string, unknown>> | undefined;
        if (builds?.length) {
          payload.builds = builds.map((b) => ({
            id: b.id,
            name: b.name,
            stage: b.stage,
            status: b.status,
          }));
        }
        break;
      }
    }

    return payload;
  }

  private formatNotificationMessage(message: NotificationMessage): string {
    const parts: string[] = [];

    if (message.title) {
      parts.push(`**[${message.level.toUpperCase()}] ${message.title}**`);
    }
    parts.push(message.content);

    if (message.fields?.length) {
      parts.push('');
      for (const field of message.fields) {
        parts.push(`**${field.label}:** ${field.value}`);
      }
    }

    if (message.actions?.length) {
      parts.push('');
      for (const action of message.actions) {
        parts.push(`[${action.label}](${action.url})`);
      }
    }

    return parts.join('\n');
  }
}
