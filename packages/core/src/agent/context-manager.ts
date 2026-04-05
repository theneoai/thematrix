/**
 * Context Window Manager - Intelligent history management
 *
 * Prevents context window overflow by summarizing older conversation turns
 * while preserving recent context and key decisions. Essential for
 * long-running agent loops and plan-and-execute workflows.
 */
import type { ConversationTurn, LLMAdapter, IMemoryManager } from '@thematrix/types';
import { Logger } from '@thematrix/utils';

const logger = new Logger({ prefix: 'ContextManager' });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_CONTEXT_TOKENS = 8_000;
const DEFAULT_SUMMARIZATION_THRESHOLD = 0.75;
const DEFAULT_RECENT_TURNS_TO_KEEP = 6;

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

    const summary = await this.summarizeHistory(oldTurns, existingSummary);

    // Build the summary turn
    const summaryTurn: ConversationTurn = {
      turnId: SUMMARY_TURN_MARKER,
      role: 'system',
      content: summary,
      timestamp: new Date(),
    };

    // Replace history in memory: clear and re-append
    await memory.clearHistory(instanceId);
    await memory.appendTurn(instanceId, summaryTurn);
    for (const turn of recentTurns) {
      await memory.appendTurn(instanceId, turn);
    }

    const optimized = [summaryTurn, ...recentTurns];

    logger.info(
      `Context compressed: ${history.length} turns → ${optimized.length} turns ` +
        `(~${this.estimateTokensForTurns(optimized)} tokens)`,
    );

    return optimized;
  }

  /**
   * Rough token estimation: ~4 characters per token.
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Use the LLM to produce a concise summary of the given conversation turns.
   */
  async summarizeHistory(
    turns: ConversationTurn[],
    priorContext?: string,
  ): Promise<string> {
    const formatted = this.formatTurnsForSummary(turns);

    let userPrompt = 'Summarize the following conversation history:\n\n' + formatted;
    if (priorContext) {
      userPrompt +=
        '\n\nPrior accumulated context (from earlier summarization):\n' + priorContext;
    }

    const response = await this.llmAdapter.chat({
      model: this.model,
      messages: [
        { role: 'system', content: SUMMARIZATION_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      maxTokens: Math.floor(this.maxContextTokens * 0.25),
    });

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
