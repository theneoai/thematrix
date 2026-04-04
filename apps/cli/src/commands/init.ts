/**
 * Init 命令
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, join } from 'path';
import { startSpinner, stopSpinner } from '../ui/spinner.js';

const GITIGNORE_TEMPLATE = `node_modules/
dist/
*.log
.env
.env.local
.DS_Store
data/
*.db
`;

const README_TEMPLATE = `# {{name}}

A TheMatrix multi-agent workflow project.

## Getting Started

\`\`\`bash
# Install dependencies
pnpm install

# Create an agent
matrix agent create "My Agent"

# Create a workflow
matrix workflow create "My Workflow"

# Run a workflow
matrix workflow run my-workflow --input input.json
\`\`\`

## Project Structure

\`\`\`
.
├── agents/          # Agent definitions
├── workflows/       # Workflow definitions
├── skills/          # Custom skills
└── data/            # Runtime data
\`\`\`

## Documentation

See [TheMatrix Documentation](https://github.com/theneoai/thematrix) for more details.
`;

const SAMPLE_AGENT_TEMPLATE = `id: hello-agent
name: Hello Agent
version: "1.0.0"

persona:
  systemPrompt: |
    You are a friendly greeting agent. Your job is to greet users warmly.
  personality: "friendly and welcoming"
  role: greeter
  temperature: 0.8
  traits:
    communication_style: "warm and enthusiastic"
    expertise: "greeting people"

model:
  provider: mock
  model: mock-model
  maxTokens: 512

skills: []

tools: []

memory:
  persistHistory: false
  maxHistoryTurns: 10
  scopes:
    - scope: agent-local
      access: read-write

maxConcurrency: 1
turnTimeoutMs: 30000
`;

const SAMPLE_WORKFLOW_TEMPLATE = `id: hello-world
name: Hello World
version: "1.0.0"
description: "A simple greeting workflow"
mode: dag

agents:
  greeter:
    ref: ./agents/hello.agent.yaml

dag:
  nodes:
    - id: greet
      agentId: greeter
      type: task
      inputMapping:
        name: "$.input.name"
  
  edges: []

sharedMemory:
  kvStore: in-memory
  persistent: false
`;

export function createInitCommand(): Command {
  return new Command('init')
    .description('Initialize a new TheMatrix project')
    .option('-t, --template <name>', 'Project template', 'default')
    .argument('[name]', 'Project name', 'my-matrix-project')
    .action(async (name, options) => {
      try {
        const projectDir = resolve(name);
        
        if (existsSync(projectDir) && (await readdirSafe(projectDir)).length > 0) {
          console.error(chalk.red(`Directory ${name} is not empty`));
          process.exit(1);
        }

        const spinner = startSpinner(`Initializing project: ${name}...`);

        // Create directories
        await mkdir(projectDir, { recursive: true });
        await mkdir(join(projectDir, 'agents'), { recursive: true });
        await mkdir(join(projectDir, 'workflows'), { recursive: true });
        await mkdir(join(projectDir, 'skills'), { recursive: true });
        await mkdir(join(projectDir, 'data'), { recursive: true });

        // Create files
        await writeFile(join(projectDir, '.gitignore'), GITIGNORE_TEMPLATE);
        await writeFile(join(projectDir, 'README.md'), README_TEMPLATE.replace(/{{name}}/g, name));
        
        if (options.template === 'default') {
          await writeFile(join(projectDir, 'agents', 'hello.agent.yaml'), SAMPLE_AGENT_TEMPLATE);
          await writeFile(join(projectDir, 'workflows', 'hello.workflow.yaml'), SAMPLE_WORKFLOW_TEMPLATE);
        }

        stopSpinner(true, `Project initialized at ${projectDir}`);
        
        console.log(chalk.green('\nNext steps:\n'));
        console.log(`  cd ${name}`);
        console.log('  pnpm install');
        console.log('  matrix agent list');
        console.log();
      } catch (error) {
        stopSpinner(false, `Failed to initialize project: ${error}`);
        process.exit(1);
      }
    });
}

async function readdirSafe(dir: string): Promise<string[]> {
  try {
    const { readdir } = await import('fs/promises');
    return await readdir(dir);
  } catch {
    return [];
  }
}
