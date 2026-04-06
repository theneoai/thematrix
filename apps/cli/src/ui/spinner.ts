/**
 * CLI UI 组件 - Spinner
 */
import ora, { type Ora } from 'ora';

let currentSpinner: Ora | null = null;

export function startSpinner(text: string): Ora {
  currentSpinner = ora({
    text,
    // Disable spinner in non-TTY environments (CI, pipes, log files)
    isEnabled: process.stderr.isTTY !== false,
  }).start();
  return currentSpinner;
}

export function stopSpinner(success = true, text?: string): void {
  if (currentSpinner) {
    if (success) {
      currentSpinner.succeed(text);
    } else {
      currentSpinner.fail(text);
    }
    currentSpinner = null;
  }
}

export function updateSpinner(text: string): void {
  if (currentSpinner) {
    currentSpinner.text = text;
  }
}
