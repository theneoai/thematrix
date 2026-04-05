/**
 * ApprovalManager - Human-in-the-Loop approval gates for workflow execution
 */
import type {
  ApprovalRequest,
  ApprovalStatus,
  IApprovalManager,
  IEventBus,
  DomainEvent,
} from '@thematrix/types';
import { EventTypes } from '@thematrix/types';
import { Logger, generateId } from '@thematrix/utils';

const logger = new Logger({ prefix: 'ApprovalManager' });

interface PendingApproval {
  resolve: (status: ApprovalStatus) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export class ApprovalManager implements IApprovalManager {
  private approvals = new Map<string, ApprovalRequest>();
  private pending = new Map<string, PendingApproval>();
  private eventBus: IEventBus;

  constructor(eventBus: IEventBus) {
    this.eventBus = eventBus;
  }

  async requestApproval(
    request: Omit<ApprovalRequest, 'id' | 'status' | 'requestedAt'>,
  ): Promise<ApprovalRequest> {
    const approval: ApprovalRequest = {
      ...request,
      id: generateId(),
      status: 'pending',
      requestedAt: new Date(),
    };

    this.approvals.set(approval.id, approval);

    await this.publishEvent(EventTypes.APPROVAL_REQUESTED, {
      approvalId: approval.id,
      workflowRunId: approval.workflowRunId,
      nodeId: approval.nodeId,
      message: approval.message,
    });

    logger.info(
      `Approval requested: ${approval.id} for workflow ${approval.workflowRunId} node ${approval.nodeId}`,
    );

    // Send HTTP POST notification if callbackUrl is configured
    if (approval.callbackUrl) {
      this.sendCallback(approval).catch((err) => {
        logger.warn(`Failed to send approval callback to ${approval.callbackUrl}:`, err);
      });
    }

    return approval;
  }

  async approve(approvalId: string, respondedBy?: string): Promise<void> {
    const approval = this.approvals.get(approvalId);
    if (!approval) {
      throw new Error(`Approval not found: ${approvalId}`);
    }
    if (approval.status !== 'pending') {
      throw new Error(`Approval ${approvalId} is already ${approval.status}`);
    }

    approval.status = 'approved';
    approval.respondedAt = new Date();
    approval.respondedBy = respondedBy;

    const pending = this.pending.get(approvalId);
    if (pending) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.resolve('approved');
      this.pending.delete(approvalId);
    }

    await this.publishEvent(EventTypes.APPROVAL_APPROVED, {
      approvalId,
      workflowRunId: approval.workflowRunId,
      nodeId: approval.nodeId,
      respondedBy,
    });

    logger.info(`Approval ${approvalId} approved${respondedBy ? ` by ${respondedBy}` : ''}`);
  }

  async reject(approvalId: string, respondedBy?: string): Promise<void> {
    const approval = this.approvals.get(approvalId);
    if (!approval) {
      throw new Error(`Approval not found: ${approvalId}`);
    }
    if (approval.status !== 'pending') {
      throw new Error(`Approval ${approvalId} is already ${approval.status}`);
    }

    approval.status = 'rejected';
    approval.respondedAt = new Date();
    approval.respondedBy = respondedBy;

    const pending = this.pending.get(approvalId);
    if (pending) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.resolve('rejected');
      this.pending.delete(approvalId);
    }

    await this.publishEvent(EventTypes.APPROVAL_REJECTED, {
      approvalId,
      workflowRunId: approval.workflowRunId,
      nodeId: approval.nodeId,
      respondedBy,
    });

    logger.info(`Approval ${approvalId} rejected${respondedBy ? ` by ${respondedBy}` : ''}`);
  }

  getStatus(approvalId: string): ApprovalRequest | undefined {
    return this.approvals.get(approvalId);
  }

  waitForApproval(approvalId: string, timeoutMs?: number): Promise<ApprovalStatus> {
    const approval = this.approvals.get(approvalId);
    if (!approval) {
      return Promise.reject(new Error(`Approval not found: ${approvalId}`));
    }

    // Already resolved
    if (approval.status !== 'pending') {
      return Promise.resolve(approval.status);
    }

    return new Promise<ApprovalStatus>((resolve) => {
      const entry: PendingApproval = { resolve };

      // Register pending BEFORE setting timeout to prevent race with approve/reject
      this.pending.set(approvalId, entry);

      if (timeoutMs !== undefined && timeoutMs > 0) {
        entry.timer = setTimeout(async () => {
          // Only time out if still pending (approve/reject may have resolved already)
          if (approval.status !== 'pending') return;

          approval.status = 'timed_out';
          approval.respondedAt = new Date();
          this.pending.delete(approvalId);

          await this.publishEvent(EventTypes.APPROVAL_TIMED_OUT, {
            approvalId,
            workflowRunId: approval.workflowRunId,
            nodeId: approval.nodeId,
            timeoutMs,
          }).catch((err) => {
            logger.warn(`Failed to publish timeout event for ${approvalId}:`, err);
          });

          logger.info(`Approval ${approvalId} timed out after ${timeoutMs}ms`);
          resolve('timed_out');
        }, timeoutMs);
      }
    });
  }

  listPending(): ApprovalRequest[] {
    const results: ApprovalRequest[] = [];
    for (const approval of this.approvals.values()) {
      if (approval.status === 'pending') {
        results.push(approval);
      }
    }
    return results;
  }

  dispose(): void {
    for (const entry of this.pending.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.pending.clear();
    logger.info('ApprovalManager disposed');
  }

  private async sendCallback(approval: ApprovalRequest): Promise<void> {
    const body = JSON.stringify({
      approvalId: approval.id,
      workflowRunId: approval.workflowRunId,
      nodeId: approval.nodeId,
      message: approval.message,
      requestedAt: approval.requestedAt.toISOString(),
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(approval.callbackUrl!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        logger.warn(
          `Approval callback to ${approval.callbackUrl} returned ${response.status}`,
        );
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async publishEvent(type: string, payload: unknown): Promise<void> {
    const workflowRunId =
      payload && typeof payload === 'object' && 'workflowRunId' in payload
        ? String((payload as Record<string, unknown>).workflowRunId)
        : 'unknown';

    const event: DomainEvent = {
      eventId: generateId(),
      type,
      source: { kind: 'workflow', id: workflowRunId },
      timestamp: new Date(),
      payload,
      correlationId: workflowRunId,
    };

    await this.eventBus.publish(event);
  }
}
