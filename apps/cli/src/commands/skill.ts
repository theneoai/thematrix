/**
 * Skill 命令
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { writeFile, mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { startSpinner, stopSpinner } from '../ui/spinner.js';
import { renderTable } from '../ui/table.js';

const SKILL_TEMPLATE = `{
  "id": "{{id}}",
  "name": "{{name}}",
  "version": "1.0.0",
  "description": "A custom skill",
  "entryPoint": "index.js",
  "tools": [
    {
      "name": "example",
      "description": "An example tool",
      "parameters": {
        "type": "object",
        "properties": {
          "input": {
            "type": "string",
            "description": "Input parameter"
          }
        },
        "required": ["input"]
      }
    }
  ],
  "permissions": [
    {
      "resource": "file",
      "actions": ["read", "write"]
    }
  ]
}
`;

const SKILL_CODE_TEMPLATE = `/**
 * {{name}} Skill
 */

export async function initialize(context) {
  console.log('Skill initialized:', context.skillId);
}

export async function dispose() {
  console.log('Skill disposed');
}

export const handlers = {
  async example(args, context) {
    const { input } = args;
    return {
      result: \`Processed: \${input}\`,
    };
  },
};
`;

export function createSkillCommand(): Command {
  const skill = new Command('skill')
    .description('Manage skills');

  skill
    .command('list')
    .description('List available skills')
    .option('-d, --dir <path>', 'Skills directory', './skills')
    .action(async (options) => {
      try {
        const dir = resolve(options.dir);
        if (!existsSync(dir)) {
          console.log(chalk.yellow('No skills directory found.'));
          return;
        }

        const entries = await readdir(dir, { withFileTypes: true });
        const skillDirs = entries.filter(e => e.isDirectory());

        if (skillDirs.length === 0) {
          console.log(chalk.yellow('No skills found.'));
          return;
        }

        const skills = skillDirs.map(d => ({
          id: d.name,
          name: d.name,
          directory: join(options.dir, d.name),
        }));

        console.log(renderTable(skills, [
          { key: 'id', header: 'ID' },
          { key: 'directory', header: 'Directory' },
        ]));
      } catch (error) {
        console.error(chalk.red(`Error: ${error}`));
        process.exit(1);
      }
    });

  skill
    .command('create <name>')
    .description('Scaffold a new skill')
    .option('-o, --output <path>', 'Output directory', './skills')
    .action(async (name, options) => {
      try {
        const spinner = startSpinner(`Creating skill: ${name}...`);

        const id = name.toLowerCase().replace(/\s+/g, '-');
        const outputDir = resolve(join(options.output, id));
        
        await mkdir(outputDir, { recursive: true });

        const manifestContent = SKILL_TEMPLATE
          .replace(/{{id}}/g, id)
          .replace(/{{name}}/g, name);

        const codeContent = SKILL_CODE_TEMPLATE
          .replace(/{{name}}/g, name);

        await writeFile(join(outputDir, 'skill.json'), manifestContent);
        await writeFile(join(outputDir, 'index.js'), codeContent);

        stopSpinner(true, `Created skill: ${outputDir}`);
      } catch (error) {
        stopSpinner(false, `Failed to create skill: ${error}`);
        process.exit(1);
      }
    });

  skill
    .command('install <name>')
    .description('Install a skill')
    .action(async (name) => {
      console.log(chalk.blue(`Installing skill: ${name}`));
      console.log(chalk.yellow('Note: Skill installation is not yet implemented.'));
    });

  return skill;
}
