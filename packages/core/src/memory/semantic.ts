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
    if (documents.length > BATCH_SIZE) {
      // Process in batches to avoid overwhelming embedding API
      const allIds: string[] = [];
      for (let i = 0; i < documents.length; i += BATCH_SIZE) {
        const batch = documents.slice(i, i + BATCH_SIZE);
        const batchIds = await this.storeMany(collection, batch);
        allIds.push(...batchIds);
      }
      return allIds;
    }

    const texts = documents.map(d => d.content);
    const embeddings = await this.embeddingProvider.embed(texts);
    const ids: string[] = [];

    const vectorDocs = documents.map((doc, i) => {
      const id = generateId();
      ids.push(id);
      return {
        id,
        content: doc.content,
        embedding: embeddings[i],
        metadata: doc.metadata ?? {},
      };
    });

    await this.vectorStore.upsert(collection, vectorDocs);
    logger.debug(`Stored ${documents.length} documents in "${collection}"`);
    return ids;
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
