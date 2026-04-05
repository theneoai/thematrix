/**
 * SemanticMemory - High-level semantic memory backed by vector store + embeddings
 */
import type {
  IVectorStore,
  IEmbeddingProvider,
  VectorSearchResult,
  VectorFilter,
} from '@thematrix/types';
import { Logger, generateId } from '@thematrix/utils';

const logger = new Logger({ prefix: 'SemanticMemory' });

export class SemanticMemory {
  private vectorStore: IVectorStore;
  private embeddingProvider: IEmbeddingProvider;

  constructor(vectorStore: IVectorStore, embeddingProvider: IEmbeddingProvider) {
    this.vectorStore = vectorStore;
    this.embeddingProvider = embeddingProvider;
  }

  /**
   * Initialize a collection for storing semantic memories.
   */
  async initialize(collection: string, dimension?: number): Promise<void> {
    const dim = dimension ?? this.embeddingProvider.dimension;
    await this.vectorStore.createCollection(collection, dim);
    logger.info(`Initialized semantic memory collection "${collection}" (dimension=${dim})`);
  }

  /**
   * Store a single document in the vector store.
   * Returns the generated document ID.
   */
  async store(
    collection: string,
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<string> {
    const [embedding] = await this.embeddingProvider.embed([content]);
    const id = generateId();

    await this.vectorStore.upsert(collection, [
      {
        id,
        content,
        embedding,
        metadata: metadata ?? {},
      },
    ]);

    logger.debug(`Stored document ${id} in "${collection}"`);
    return id;
  }

  /**
   * Store multiple documents in batch.
   * Returns the generated document IDs.
   */
  async storeMany(
    collection: string,
    documents: Array<{ content: string; metadata?: Record<string, unknown> }>
  ): Promise<string[]> {
    const BATCH_SIZE = 100;
    const allIds: string[] = [];

    // Iterative batching to avoid stack overflow on large document sets
    for (let i = 0; i < documents.length; i += BATCH_SIZE) {
      const batch = documents.slice(i, i + BATCH_SIZE);
      const texts = batch.map(d => d.content);
      const embeddings = await this.embeddingProvider.embed(texts);

      const vectorDocs = batch.map((doc, j) => {
        const id = generateId();
        allIds.push(id);
        return {
          id,
          content: doc.content,
          embedding: embeddings[j],
          metadata: doc.metadata ?? {},
        };
      });

      await this.vectorStore.upsert(collection, vectorDocs);
    }

    logger.debug(`Stored ${documents.length} documents in "${collection}"`);
    return allIds;
  }

  /**
   * Retrieve semantically similar documents for a query.
   */
  async retrieve(
    collection: string,
    query: string,
    topK?: number,
    filter?: VectorFilter
  ): Promise<VectorSearchResult[]> {
    const [queryEmbedding] = await this.embeddingProvider.embed([query]);
    const results = await this.vectorStore.query(collection, queryEmbedding, topK, filter);
    logger.debug(`Retrieved ${results.length} results from "${collection}" for query`);
    return results;
  }
}
