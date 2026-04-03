/**
 * Workflow 命令
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { writeFile, readFile, mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { loadWorkflowDefinition, validateWorkflowDefinition, ConfigValidationError } from '@thematrix/config';
import { startSpinner, stopSpinner, updateSpinner } from '../ui/spinner.js';
import { renderTable } from '../ui/table.js';
import { Logger } from '@thematrix/utils';

const logger = new Logger({ prefix: 'CLI', enableColors: true });

const WORKFLOW_TEMPLATE = `id: {{id}}
name: {{name}}
version: "1.0.0"
description: "A sample workflow"
mode: dag

agents:
  agent1:
    ref: ./agents/sample.agent.yaml

dag:
  nodes:
    - id: step1
      agentId: agent1
      type: task
      inputMapping:
        input: "$.input.data"
  
  edges: []

sharedMemory:
  kvStore: sqlite
  persistent: true
`;

export function createWorkflowCommand(): Command {
  const workflow = new Command('workflow')
    .description('Manage workflow definitions');

  workflow
    .command('create <name>')
    .description('Create a new workflow definition')
    .option('-o, --output <path>', 'Output directory', './workflows')
    .action(async (name, options) => {
      try {
        const spinner = startSpinner(`Creating workflow: ${name}...`);

        const id = name.toLowerCase().replace(/\s+/g, '-');
        const content = WORKFLOW_TEMPLATE
          .replace(/{{id}}/g, id)
          .replace(/{{name}}/g, name);

        const outputDir = resolve(options.output);
        if (!existsSync(outputDir)) {
          await mkdir(outputDir, { recursive: true });
        }

        const filePath = join(outputDir, `${id}.workflow.yaml`);
        await writeFile(filePath, content);

        stopSpinner(true, `Created workflow: ${filePath}`);
      } catch (error) {
        stopSpinner(false, `Failed to create workflow: ${error}`);
        process.exit(1);
      }
    });

  workflow
    .command('list')
    .description('List all workflow definitions')
    .option('-d, --dir <path>', 'Workflows directory', './workflows')
    .action(async (options) => {
      try {
        const dir = resolve(options.dir);
        if (!existsSync(dir)) {
          console.log(chalk.yellow('No workflows directory found.'));
          return;
        }

        const files = await readdir(dir);
        const workflowFiles = files.filter(f => f.endsWith('.workflow.yaml'));

        if (workflowFiles.length === 0) {
          console.log(chalk.yellow('No workflows found.'));
          return;
        }

        const workflows = [];
        for (const file of workflowFiles) {
          try {
            const content = await readFile(join(dir, file), 'utf-8');
            const idMatch = content.match(/^id:\s*(.+)$/m);
            const nameMatch = content.match(/^name:\s*(.+)$/m);
            const modeMatch = content.match(/^mode:\s*(.+)$/m);
            workflows.push({
              id: idMatch?.[1]?.trim() ?? file,
              name: nameMatch?.[1]?.trim() ?? file,
              mode: modeMatch?.[1]?.trim() ?? 'unknown',
              file,
            });
          } catch {
            // Skip invalid files
          }
        }

        console.log(renderTable(workflows, [
          { key: 'id', header: 'ID' },
          { key: 'name', header: 'Name' },
          { key: 'mode', header: 'Mode' },
          { key: 'file', header: 'File' },
        ]));
      } catch (error) {
        console.error(chalk.red(`Error: ${error}`));
        process.exit(1);
      }
    });

  workflow
    .command('show <id>')
    .description('Show workflow details')
    .option('-d, --dir <path>', 'Workflows directory', './workflows')
    .action(async (id, options) => {
      try {
        const filePath = join(resolve(options.dir), `${id}.workflow.yaml`);
        const definition = await loadWorkflowDefinition(filePath);

        console.log(chalk.bold('\nWorkflow Definition:\n'));
        console.log(`  ID: ${chalk.cyan(definition.id)}`);
        console.log(`  Name: ${chalk.cyan(definition.name)}`);
        console.log(`  Version: ${chalk.cyan(definition.version)}`);
        console.log(`  Mode: ${chalk.cyan(definition.mode)}`);
        console.log(`  Agents: ${chalk.cyan(Object.keys(definition.agents).join(', '))}`);
        
        if (definition.dag) {
          console.log(`  Nodes: ${chalk.cyan(definition.dag.nodes.length)}`);
          console.log(`  Edges: ${chalk.cyan(definition.dag.edges.length)}`);
        }
        
        console.log();
      } catch (error) {
        if (error instanceof ConfigValidationError) {
          console.error(chalk.red('Validation errors:'));
          error.errors.forEach(e => console.error(chalk.red(`  - ${e}`)));
        } else {
          console.error(chalk.red(`Error: ${error}`));
        }
        process.exit(1);
      }
    });

  workflow
    .command('validate <file>')
    .description('Validate a workflow YAML file')
    .action(async (file) => {
      try {
        const spinner = startSpinner(`Validating ${file}...`);
        await loadWorkflowDefinition(resolve(file));
        stopSpinner(true, `${file} is valid`);
      } catch (error) {
        stopSpinner(false, `Validation failed`);
        if (error instanceof ConfigValidationError) {
          console.error(chalk.red('Errors:'));
          error.errors.forEach(e => console.error(chalk.red(`  - ${e}`)));
        } else {
          console.error(chalk.red(`Error: ${error}`));
        }
        process.exit(1);
      }
    });

  workflow
    .command('run <id>')
    .description('Run a workflow')
    .option('-d, --dir <path>', 'Workflows directory', './workflows')
    .option('-a, --agents <dir>', 'Agents directory', './agents')
    .option('-i, --input <file>', 'Input JSON file')
    .action(async (id, options) => {
      try {
        const { Runtime } = await import('@thematrix/core');
        const { loadAgentDefinition } = await import('@thematrix/config');
        const { readFile } = await import('fs/promises');
        
        const spinner = startSpinner(`Loading workflow: ${id}...`);
        
        // Load workflow
        const workflowPath = join(resolve(options.dir), `${id}.workflow.yaml`);
        const definition = await loadWorkflowDefinition(workflowPath);
        
        // Load input
        let input: Record<string, unknown> = {};
        if (options.input) {
          const inputContent = await readFile(resolve(options.input), 'utf-8');
          input = JSON.parse(inputContent);
        }
        
        updateSpinner('Initializing runtime...');
        
        // Create and start runtime
        const runtime = new Runtime({ dbPath: './data/runtime.db' });
        await runtime.start();
        
        // Load and register agents
        for (const [name, ref] of Object.entries(definition.agents)) {
          const agentPath = join(resolve(options.agents), `${ref.ref.replace('./', '').replace('.agent.yaml', '')}.agent.yaml`);
          try {
            const agentDef = await loadAgentDefinition(agentPath);
            // Register with aliases: file path reference and agent name
            runtime.registerAgent(agentDef, [ref.ref, name]);
          } catch (e) {
            logger.warn(`Could not load agent ${name}: ${e}`);
          }
        }
        
        updateSpinner('Starting workflow...');
        
        // Run workflow
        const run = await runtime.runWorkflow(definition, input);
        
        stopSpinner(true, `Workflow started: ${run.runId}`);
        
        console.log(chalk.green(`\nWorkflow run ID: ${run.runId}`));
        console.log(chalk.gray(`Status: ${run.status}`));
        
        // Wait a bit for workflow to complete (in production, this would poll)
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const finalRun = runtime.getWorkflowRun(run.runId);
        if (finalRun?.status === 'completed') {
          console.log(chalk.green('\n✓ Workflow completed successfully'));
          if (finalRun.output) {
            console.log(chalk.gray('\nOutput:'));
            console.log(JSON.stringify(finalRun.output, null, 2));
          }
        } else if (finalRun?.status === 'failed') {
          console.log(chalk.red('\n✗ Workflow failed'));
          if (finalRun.error) {
            console.log(chalk.red(`Error: ${finalRun.error}`));
          }
        } else {
          console.log(chalk.yellow(`\n⏳ Workflow is still running: ${finalRun?.status}`));
        }
        
        await runtime.stop();
      } catch (error) {
        stopSpinner(false, 'Failed to run workflow');
        if (error instanceof ConfigValidationError) {
          console.error(chalk.red('Validation errors:'));
          error.errors.forEach(e => console.error(chalk.red(`  - ${e}`)));
        } else {
          console.error(chalk.red(`Error: ${error}`));
        }
        process.exit(1);
      }
    });

  workflow
    .command('status <runId>')
    .description('Check workflow run status')
    .action(async (runId) => {
      console.log(chalk.blue(`Checking status for run: ${runId}`));
      console.log(chalk.yellow('Note: This requires workflow tracking to be implemented.'));
    });

  workflow
    .command('history')
    .description('List past workflow runs')
    .action(async () => {
      console.log(chalk.yellow('No workflow history available yet.'));
    });

  return workflow;
}
