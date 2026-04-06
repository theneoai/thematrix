/**
 * Agent 命令
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { writeFile, readFile, mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { loadAgentDefinition, validateAgentDefinition, ConfigValidationError } from '@thematrix/config';
import { startSpinner, stopSpinner } from '../ui/spinner.js';
import { renderTable } from '../ui/table.js';

const AGENT_TEMPLATE = `id: {{id}}
name: {{name}}
version: "1.0.0"

persona:
  systemPrompt: |
    You are a helpful AI assistant.
  personality: "helpful and friendly"
  role: assistant
  temperature: 0.7
  traits:
    communication_style: "clear and concise"
    expertise: "general assistance"

model:
  provider: mock
  model: mock-model
  maxTokens: 2048

skills: []

tools:
  - name: read_file
    permission: allow
  - name: write_file
    permission: confirm

memory:
  persistHistory: true
  maxHistoryTurns: 50
  scopes:
    - scope: agent-local
      access: read-write
    - scope: workflow-shared
      access: read

maxConcurrency: 1
turnTimeoutMs: 60000
`;

export function createAgentCommand(): Command {
  const agent = new Command('agent')
    .description('Manage agent definitions');

  agent
    .command('create <name>')
    .description('Create a new agent definition')
    .option('-o, --output <path>', 'Output directory', './agents')
    .action(async (name, options) => {
      try {
        const spinner = startSpinner(`Creating agent: ${name}...`);

        const id = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        if (!id) {
          throw new Error('Agent name must contain at least one alphanumeric character');
        }
        const content = AGENT_TEMPLATE
          .replace(/{{id}}/g, id)
          .replace(/{{name}}/g, name);

        const outputDir = resolve(options.output);
        if (!existsSync(outputDir)) {
          await mkdir(outputDir, { recursive: true });
        }

        const filePath = join(outputDir, `${id}.agent.yaml`);
        if (existsSync(filePath)) {
          throw new Error(`Agent file already exists: ${filePath}\nUse a different name or delete the existing file.`);
        }
        await writeFile(filePath, content);

        stopSpinner(true, `Created agent: ${filePath}`);
      } catch (error) {
        stopSpinner(false, `Failed to create agent: ${error}`);
        process.exit(1);
      }
    });

  agent
    .command('list')
    .description('List all agent definitions')
    .option('-d, --dir <path>', 'Agents directory', './agents')
    .action(async (options) => {
      try {
        const dir = resolve(options.dir);
        if (!existsSync(dir)) {
          console.log(chalk.yellow('No agents directory found.'));
          return;
        }

        const files = await readdir(dir);
        const agentFiles = files.filter(f => f.endsWith('.agent.yaml'));

        if (agentFiles.length === 0) {
          console.log(chalk.yellow('No agents found.'));
          return;
        }

        const agents = [];
        for (const file of agentFiles) {
          try {
            const content = await readFile(join(dir, file), 'utf-8');
            // Simple parsing to extract id and name
            const idMatch = content.match(/^id:\s*(.+)$/m);
            const nameMatch = content.match(/^name:\s*(.+)$/m);
            agents.push({
              id: idMatch?.[1]?.trim() ?? file,
              name: nameMatch?.[1]?.trim() ?? file,
              file,
            });
          } catch {
            // Skip invalid files
          }
        }

        console.log(renderTable(agents, [
          { key: 'id', header: 'ID' },
          { key: 'name', header: 'Name' },
          { key: 'file', header: 'File' },
        ]));
      } catch (error) {
        console.error(chalk.red(`Error: ${error}`));
        process.exit(1);
      }
    });

  agent
    .command('show <id>')
    .description('Show agent details')
    .option('-d, --dir <path>', 'Agents directory', './agents')
    .action(async (id, options) => {
      try {
        const filePath = join(resolve(options.dir), `${id}.agent.yaml`);
        const definition = await loadAgentDefinition(filePath);

        console.log(chalk.bold('\nAgent Definition:\n'));
        console.log(`  ID: ${chalk.cyan(definition.id)}`);
        console.log(`  Name: ${chalk.cyan(definition.name)}`);
        console.log(`  Version: ${chalk.cyan(definition.version)}`);
        console.log(`  Role: ${chalk.cyan(definition.persona.role)}`);
        console.log(`  Provider: ${chalk.cyan(definition.model.provider)}`);
        console.log(`  Model: ${chalk.cyan(definition.model.model)}`);
        console.log(`  Skills: ${chalk.cyan(definition.skills.length)}`);
        console.log(`  Tools: ${chalk.cyan(definition.tools.length)}`);
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

  agent
    .command('validate <file>')
    .description('Validate an agent YAML file')
    .action(async (file) => {
      try {
        const spinner = startSpinner(`Validating ${file}...`);
        await loadAgentDefinition(resolve(file));
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

  return agent;
}
