/**
 * Workspace Manager
 *
 * Manages temporary directories and git worktrees for agent execution.
 */

import { mkdir, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { WorkspaceConfig } from '@thematrix/types';
import { Logger, generateId } from '@thematrix/utils';

const logger = new Logger({ prefix: 'WorkspaceManager' });
const execFileAsync = promisify(execFile);

export interface WorkspaceInfo {
  workspaceId: string;
  path: string;
  config: WorkspaceConfig;
  createdAt: Date;
}

export class WorkspaceManager {
  private workspaces = new Map<string, WorkspaceInfo>();

  /**
   * Create a workspace according to the provided config.
   */
  async create(config: WorkspaceConfig): Promise<WorkspaceInfo> {
    const workspaceId = generateId();

    let workspacePath: string;

    switch (config.type) {
      case 'temp-dir':
        workspacePath = await this.createTempDir(config);
        break;

      case 'git-worktree':
        workspacePath = await this.createGitWorktree(config, workspaceId);
        break;

      case 'shared-volume':
        workspacePath = await this.createSharedVolume(config, workspaceId);
        break;

      default:
        throw new Error(`Unsupported workspace type: ${config.type}`);
    }

    const info: WorkspaceInfo = {
      workspaceId,
      path: workspacePath,
      config,
      createdAt: new Date(),
    };

    this.workspaces.set(workspaceId, info);
    logger.info(`Workspace ${workspaceId} created at ${workspacePath} (type=${config.type})`);

    return info;
  }

  /**
   * Clean up a workspace by ID.
   */
  async cleanup(workspaceId: string): Promise<void> {
    const info = this.workspaces.get(workspaceId);
    if (!info) {
      logger.warn(`Workspace ${workspaceId} not found, nothing to clean up`);
      return;
    }

    if (!info.config.cleanup) {
      logger.info(`Workspace ${workspaceId} has cleanup=false, skipping removal`);
      this.workspaces.delete(workspaceId);
      return;
    }

    try {
      switch (info.config.type) {
        case 'temp-dir':
        case 'shared-volume':
          await rm(info.path, { recursive: true, force: true });
          break;

        case 'git-worktree':
          await this.removeGitWorktree(info);
          break;
      }

      logger.info(`Workspace ${workspaceId} cleaned up (${info.path})`);
    } catch (error) {
      logger.error(
        `Failed to clean up workspace ${workspaceId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    this.workspaces.delete(workspaceId);
  }

  /**
   * Get info about an existing workspace.
   */
  get(workspaceId: string): WorkspaceInfo | undefined {
    return this.workspaces.get(workspaceId);
  }

  /**
   * Clean up all managed workspaces.
   */
  async disposeAll(): Promise<void> {
    const ids = [...this.workspaces.keys()];
    for (const id of ids) {
      await this.cleanup(id);
    }
    logger.info('All workspaces disposed');
  }

  // ---- Private helpers ----

  private async createTempDir(config: WorkspaceConfig): Promise<string> {
    const base = config.basePath ?? tmpdir();
    await mkdir(base, { recursive: true });
    return mkdtemp(join(base, 'thematrix-'));
  }

  private async createGitWorktree(config: WorkspaceConfig, workspaceId: string): Promise<string> {
    if (!config.gitRepo) {
      throw new Error('git-worktree workspace requires gitRepo to be set');
    }

    const branch = config.gitBranch ?? 'main';
    const base = config.basePath ?? join(tmpdir(), 'thematrix-worktrees');
    await mkdir(base, { recursive: true });

    const worktreePath = join(base, workspaceId);

    await execFileAsync('git', [
      '-C', config.gitRepo,
      'worktree', 'add',
      worktreePath,
      branch,
    ]);

    logger.info(`Created git worktree at ${worktreePath} from ${config.gitRepo} branch ${branch}`);
    return worktreePath;
  }

  private async removeGitWorktree(info: WorkspaceInfo): Promise<void> {
    if (info.config.gitRepo) {
      try {
        await execFileAsync('git', [
          '-C', info.config.gitRepo,
          'worktree', 'remove',
          info.path,
          '--force',
        ]);
      } catch {
        // Fallback: just remove the directory
        await rm(info.path, { recursive: true, force: true });
      }
    } else {
      await rm(info.path, { recursive: true, force: true });
    }
  }

  private async createSharedVolume(config: WorkspaceConfig, workspaceId: string): Promise<string> {
    const base = config.basePath ?? join(tmpdir(), 'thematrix-shared');
    const volumePath = join(base, workspaceId);
    await mkdir(volumePath, { recursive: true });
    return volumePath;
  }
}
