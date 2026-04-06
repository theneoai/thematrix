/**
 * Config 命令
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';

const CONFIG_PATH = resolve('./.matrix/config.json');

interface Config {
  defaultProvider?: string;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  [key: string]: unknown;
}

async function loadConfig(): Promise<Config> {
  try {
    if (existsSync(CONFIG_PATH)) {
      const content = await readFile(CONFIG_PATH, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.warn(chalk.yellow(`Warning: Could not load config from ${CONFIG_PATH}: ${(error as Error).message}`));
  }
  return {};
}

async function saveConfig(config: Config): Promise<void> {
  const { mkdir } = await import('fs/promises');
  const { dirname } = await import('path');
  
  const dir = dirname(CONFIG_PATH);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function createConfigCommand(): Command {
  const config = new Command('config')
    .description('Manage configuration');

  config
    .command('show')
    .description('Show current configuration')
    .action(async () => {
      const cfg = await loadConfig();
      
      console.log(chalk.bold('\nConfiguration:\n'));
      if (Object.keys(cfg).length === 0) {
        console.log(chalk.gray('  No configuration set.\n'));
      } else {
        for (const [key, value] of Object.entries(cfg)) {
          console.log(`  ${key}: ${chalk.cyan(String(value))}`);
        }
        console.log();
      }
    });

  config
    .command('set <key> <value>')
    .description('Set a configuration value')
    .action(async (key, value) => {
      try {
        const cfg = await loadConfig();
        
        // Try to parse as JSON
        let parsedValue: unknown = value;
        try {
          parsedValue = JSON.parse(value);
        } catch {
          // Keep as string
        }
        
        cfg[key] = parsedValue;
        await saveConfig(cfg);
        
        console.log(chalk.green(`Set ${key} = ${value}`));
      } catch (error) {
        console.error(chalk.red(`Error: ${error}`));
        process.exit(1);
      }
    });

  config
    .command('get <key>')
    .description('Get a configuration value')
    .action(async (key) => {
      const cfg = await loadConfig();
      const value = cfg[key];
      
      if (value === undefined) {
        console.log(chalk.gray('(not set)'));
      } else {
        console.log(String(value));
      }
    });

  return config;
}
