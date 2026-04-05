/**
 * Embedding Providers - Generate vector embeddings from text
 */
import type { IEmbeddingProvider } from '@thematrix/types';
import { Logger } from '@thematrix/utils';

const logger = new Logger({ prefix: 'Embeddings' });

/**
 * LLMEmbeddingProvider - Development/testing embedding provider
 * Uses a deterministic hash-based approach to generate pseudo-embeddings.
 */
export class LLMEmbeddingProvider implements IEmbeddingProvider {
  readonly model: string;
  readonly dimension: number;

  constructor(model: string, dimension: number = 384) {
    this.model = model;
    this.dimension = dimension;
    logger.info(`LLMEmbeddingProvider initialized: model=${model}, dimension=${dimension}`);
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(text => this.hashEmbed(text));
  }

  /**
   * Generate a deterministic pseudo-embedding by hashing the text.
   * Not suitable for production use - provides consistent but non-semantic vectors.
   */
  private hashEmbed(text: string): number[] {
    const vector = new Array<number>(this.dimension);
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;

    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }

    // Use the two hash seeds to generate the full vector
    for (let i = 0; i < this.dimension; i++) {
      h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
      h1 = Math.imul(h1 ^ (h1 >>> 13), 3266489909);
      h1 ^= h1 >>> 16;

      h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
      h2 = Math.imul(h2 ^ (h2 >>> 13), 3266489909);
      h2 ^= h2 >>> 16;

      // Combine h1 and h2 with the index for variety
      const combined = (h1 + Math.imul(h2, i + 1)) | 0;
      // Normalize to [-1, 1]
      vector[i] = (combined / 0x7fffffff);
    }

    // Normalize the vector to unit length
    let norm = 0;
    for (let i = 0; i < this.dimension; i++) {
      norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < this.dimension; i++) {
        vector[i] /= norm;
      }
    }

    return vector;
  }
}

/**
 * APIEmbeddingProvider - Production embedding provider
 * Calls an OpenAI-compatible embeddings API endpoint.
 */
export class APIEmbeddingProvider implements IEmbeddingProvider {
  readonly model: string;
  readonly dimension: number;
  private baseUrl: string;
  private apiKey: string;

  constructor(options: {
    baseUrl: string;
    apiKey: string;
    model: string;
    dimension: number;
  }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.dimension = options.dimension;
    logger.info(`APIEmbeddingProvider initialized: model=${options.model}, baseUrl=${this.baseUrl}`);
  }

  async embed(texts: string[]): Promise<number[][]> {
    const url = `${this.baseUrl}/v1/embeddings`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Embedding API request failed (${response.status}): ${body}`);
    }

    const json = await response.json() as EmbeddingAPIResponse;

    // Sort by index to ensure correct ordering
    const sorted = json.data.sort((a, b) => a.index - b.index);
    const embeddings = sorted.map(item => item.embedding);

    // Validate dimension of returned embeddings
    for (const emb of embeddings) {
      if (emb.length !== this.dimension) {
        throw new Error(
          `Embedding dimension mismatch: expected ${this.dimension}, got ${emb.length}. ` +
          `Check model "${this.model}" configuration.`
        );
      }
    }

    return embeddings;
  }
}

interface EmbeddingAPIResponse {
  data: Array<{
    index: number;
    embedding: number[];
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}
