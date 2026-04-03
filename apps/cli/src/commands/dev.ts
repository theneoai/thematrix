/**
 * Dev 命令
 */
import { Command } from 'commander';
import chalk from 'chalk';

export function createDevCommand(): Command {
  return new Command('dev')
    .description('Start development mode (dashboard + watch)')
    .option('-p, --port <port>', 'Dashboard port', '3000')
    .action(async (options) => {
      console.log(chalk.blue('Starting development mode...'));
      console.log(chalk.gray(`Dashboard will be available at http://localhost:${options.port}`));
      console.log();
      console.log(chalk.yellow('Note: Dashboard is not yet implemented in this version.'));
      console.log(chalk.yellow('It will be available in a future release.'));
      
      // Keep process running
      console.log(chalk.gray('Press Ctrl+C to exit'));
      await new Promise(() => {});
    });
}
