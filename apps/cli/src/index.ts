#!/usr/bin/env node
/**
 * TheMatrix CLI
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { createInitCommand } from './commands/init.js';
import { createAgentCommand } from './commands/agent.js';
import { createWorkflowCommand } from './commands/workflow.js';
import { createSkillCommand } from './commands/skill.js';
import { createDevCommand } from './commands/dev.js';
import { createConfigCommand } from './commands/config.js';

const program = new Command()
  .name('matrix')
  .description('TheMatrix - Multi-Agent Workflow Orchestration CLI')
  .version('0.1.0');

// Add commands
program.addCommand(createInitCommand());
program.addCommand(createAgentCommand());
program.addCommand(createWorkflowCommand());
program.addCommand(createSkillCommand());
program.addCommand(createDevCommand());
program.addCommand(createConfigCommand());

// Global error handler
process.on('unhandledRejection', (error) => {
  console.error(chalk.red('Unexpected error:'), error);
  process.exit(1);
});

program.parse();
