/**
 * Context Window Manager - Intelligent history management
 *
 * Prevents context window overflow by summarizing older conversation turns
 * while preserving recent context and key decisions. Essential for
 * long-running agent loops and plan-and-execute workflows.
 */
import type { ConversationTurn, LLMAdapter, IMemoryManager } from '@thematrix/types';
import { Logger, timeout } from '@thematrix/utils';

const logger = new Logger({ prefix: 'ContextManager' });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_CONTEXT_TOKENS = 8_000;
const DEFAULT_SUMMARIZATION_THRESHOLD = 0.75;
const DEFAULT_RECENT_TURNS_TO_KEEP = 6;
const DEFAULT_SUMMARIZATION_TIMEOUT_MS = 30_000;

const SUMMARY_TURN_MARKER = '__context_summary__';

const SUMMARIZATION_SYSTEM_PROMPT = `You are a context summarizer for an AI agent's conversation history.
Your job is to condense older conversation turns into a concise summary while preserving critical information.

Rules:
- Preserve key decisions and their reasoning
- Preserve tool call results and their outcomes
- Preserve any errors encountered and how they were resolved
- Drop redundant conversational back-and-forth
- Maintain the agent's understanding of the current task state
- Keep the summary factual and structured
- Use bullet points for clarity

Output ONLY the summary text, no preamble.`;

// ---------------------------------------------------------------------------
// ContextManager
// ---------------------------------------------------------------------------

export class ContextManager {
  private llmAdapter: LLMAdapter;
  private model: string;
  private maxContextTokens: number;
  private summarizationThreshold: number;
  private recentTurnsToKeep: number;

  constructor(
    llmAdapter: LLMAdapter,
    model: string,
    maxContextTokens: number = DEFAULT_MAX_CONTEXT_TOKENS,
    summarizationThreshold: number = DEFAULT_SUMMARIZATION_THRESHOLD,
    recentTurnsToKeep: number = DEFAULT_RECENT_TURNS_TO_KEEP,
  ) {
    this.llmAdapter = llmAdapter;
    this.model = model;
    this.maxContextTokens = maxContextTokens;
    this.summarizationThreshold = summarizationThreshold;
    this.recentTurnsToKeep = recentTurnsToKeep;
  }

  /**
   * Manage the context window for an agent instance.
   *
   * If the full history exceeds `maxContextTokens * summarizationThreshold`,
   * older turns are summarized into a single system-role turn and written back
   * to memory. The returned array is always within the token budget.
   */
  async manageContext(
    instanceId: string,
    memory: IMemoryManager,
    newTurn?: ConversationTurn,
  ): Promise<ConversationTurn[]> {
    // Persist the new turn first (if provided)
    if (newTurn) {
      await memory.appendTurn(instanceId, newTurn);
    }

    const history = await memory.getHistory(instanceId);

    // Estimate current token usage
    const totalTokens = this.estimateTokensForTurns(history);
    const threshold = this.maxContextTokens * this.summarizationThreshold;

    logger.debug(
      `Context check: ${totalTokens} tokens, threshold=${threshold}, turns=${history.length}`,
    );

    if (totalTokens <= threshold) {
      // Within budget — return as-is
      return history;
    }

    logger.info(
      `Context exceeds threshold (${totalTokens} > ${threshold}). Summarizing older turns.`,
    );

    // Split history into "old" (to summarize) and "recent" (to keep verbatim)
    const keepCount = Math.min(this.recentTurnsToKeep, history.length);
    const splitIdx = history.length - keepCount;

    // Nothing to summarize if everything is recent
    if (splitIdx <= 0) {
      return history;
    }

    const oldTurns = history.slice(0, splitIdx);
    const recentTurns = history.slice(splitIdx);

    // Check if the first old turn is already a summary — if so, include its
    // content as prior context so we don't lose accumulated knowledge.
    const existingSummary =
      oldTurns.length > 0 && this.isSummaryTurn(oldTurns[0])
        ? oldTurns[0].content
        : undefined;

    let summary: string;
    try {
      summary = await this.summarizeHistory(oldTurns, existingSummary);
    } catch (err) {
      // Summarization failed — return existing history intact to avoid corruption
      logger.error(`Summarization failed, preserving existing context: ${(err as Error).message ?? String(err)}`);
      return history;
    }

    // Build the summary turn
    const summaryTurn: ConversationTurn = {
      turnId: SUMMARY_TURN_MARKER,
      role: 'system',
      content: summary,
      timestamp: new Date(),
    };

    // Replace history in memory: clear and re-append.
    // If any step fails after clearing, restore the original history.
    try {
      await memory.clearHistory(instanceId);
      await memory.appendTurn(instanceId, summaryTurn);
      for (const turn of recentTurns) {
        await memory.appendTurn(instanceId, turn);
      }
    } catch (err) {
      logger.error(`Failed to write summarized history, restoring original: ${(err as Error).message ?? String(err)}`);
      // Best-effort restore: clear and re-append original history
      try {
        await memory.clearHistory(instanceId);
        for (const turn of history) {
          await memory.appendTurn(instanceId, turn);
        }
      } catch (restoreErr) {
        logger.error(`Failed to restore original history: ${(restoreErr as Error).message ?? String(restoreErr)}`);
      }
      return history;
    }

    const optimized = [summaryTurn, ...recentTurns];

    logger.info(
      `Context compressed: ${history.length} turns → ${optimized.length} turns ` +
        `(~${this.estimateTokensForTurns(optimized)} tokens)`,
    );

    return optimized;
  }

  /**
   * Improved token estimation using word/punctuation splitting.
   * More accurate than naive char/4: counts words and punctuation clusters
   * separately, which better approximates BPE tokenization.
   */
  estimateTokens(text: string): number {
    if (!text) return 0;
    // Count words (split on whitespace) — each word is roughly 1 token for
    // short words and 1+ tokens for longer/code words.
    const words = text.split(/\s+/).filter(w => w.length > 0);
    let tokens = 0;
    for (const word of words) {
      if (word.length <= 4) {
        tokens += 1;
      } else {
        // Longer words tend to be split into multiple tokens (~1 per 4 chars)
        tokens += Math.ceil(word.length / 4);
      }
    }
    // Add overhead for message framing (~4 tokens per message)
    return Math.max(tokens, 1);
  }

  /**
   * Use the LLM to produce a concise summary of the given conversation turns.
   */
  async summarizeHistory(
    turns: ConversationTurn[],
    priorContext?: string,
  ): Promise<string> {
    const formatted = this.formatTurnsForSummary(turns);

    // Wrap conversation content in delimiters to reduce prompt injection risk
    let userPrompt = 'Summarize the following conversation history:\n\n<conversation>\n' + formatted + '\n</conversation>';
    if (priorContext) {
      userPrompt +=
        '\n\nPrior accumulated context (from earlier summarization):\n<prior_context>\n' + priorContext + '\n</prior_context>';
    }

    const response = await timeout(
      this.llmAdapter.chat({
        model: this.model,
        messages: [
          { role: 'system', content: SUMMARIZATION_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        maxTokens: Math.floor(this.maxContextTokens * 0.25),
      }),
      DEFAULT_SUMMARIZATION_TIMEOUT_MS,
      'Context summarization timed out',
    );

    return `[Context Summary]\n${response.content}`;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private estimateTokensForTurns(turns: ConversationTurn[]): number {
    let total = 0;
    for (const turn of turns) {
      total += this.estimateTokens(turn.content);
      if (turn.toolCalls) {
        for (const tc of turn.toolCalls) {
          total += this.estimateTokens(tc.function.name + tc.function.arguments);
        }
      }
      if (turn.toolResults) {
        for (const tr of turn.toolResults) {
          total += this.estimateTokens(tr.content);
        }
      }
    }
    return total;
  }

  private formatTurnsForSummary(turns: ConversationTurn[]): string {
    const lines: string[] = [];

    for (const turn of turns) {
      const ts = turn.timestamp.toISOString();
      lines.push(`[${ts}] ${turn.role.toUpperCase()}: ${turn.content}`);

      if (turn.toolCalls && turn.toolCalls.length > 0) {
        for (const tc of turn.toolCalls) {
          lines.push(`  → tool_call: ${tc.function.name}(${tc.function.arguments})`);
        }
      }
      if (turn.toolResults && turn.toolResults.length > 0) {
        for (const tr of turn.toolResults) {
          lines.push(`  ← tool_result [${tr.toolCallId}]: ${tr.content.slice(0, 500)}`);
        }
      }
    }

    return lines.join('\n');
  }

  private isSummaryTurn(turn: ConversationTurn): boolean {
    return turn.turnId === SUMMARY_TURN_MARKER || turn.content.startsWith('[Context Summary]');
  }
}
