/**
 * InMemoryVectorStore - In-memory vector store implementation
 */
import type { IVectorStore, VectorDocument, VectorSearchResult, VectorFilter } from '@thematrix/types';
import { Logger } from '@thematrix/utils';

const logger = new Logger({ prefix: 'InMemoryVectorStore' });

interface CollectionMeta {
  dimension: number;
  documents: Map<string, VectorDocument>;
}

export class InMemoryVectorStore implements IVectorStore {
  private collections = new Map<string, CollectionMeta>();

  async createCollection(name: string, dimension: number): Promise<void> {
    if (this.collections.has(name)) {
      logger.warn(`Collection "${name}" already exists, skipping creation`);
      return;
    }
    this.collections.set(name, { dimension, documents: new Map() });
    logger.info(`Created collection "${name}" with dimension ${dimension}`);
  }

  async dropCollection(name: string): Promise<void> {
    const deleted = this.collections.delete(name);
    if (deleted) {
      logger.info(`Dropped collection "${name}"`);
    } else {
      logger.warn(`Collection "${name}" does not exist`);
    }
  }

  async upsert(collectionName: string, documents: VectorDocument[]): Promise<void> {
    const collection = this.getCollection(collectionName);
    for (const doc of documents) {
      if (!doc.embedding || doc.embedding.length === 0) {
        throw new Error(`Document "${doc.id}" has an empty embedding vector`);
      }
      if (doc.embedding.length !== collection.dimension) {
        throw new Error(
          `Embedding dimension mismatch: expected ${collection.dimension}, got ${doc.embedding.length}`
        );
      }
      collection.documents.set(doc.id, doc);
    }
    logger.debug(`Upserted ${documents.length} documents into "${collectionName}"`);
  }

  async query(
    collectionName: string,
    queryVector: number[],
    topK: number = 5,
    filter?: VectorFilter
  ): Promise<VectorSearchResult[]> {
    if (topK < 1) {
      throw new Error(`topK must be at least 1, got ${topK}`);
    }
    if (!queryVector || queryVector.length === 0) {
      throw new Error('Query vector must not be empty');
    }

    const collection = this.getCollection(collectionName);

    if (queryVector.length !== collection.dimension) {
      throw new Error(
        `Query vector dimension mismatch: expected ${collection.dimension}, got ${queryVector.length}`
      );
    }

    const results: VectorSearchResult[] = [];

    for (const doc of collection.documents.values()) {
      if (filter && !matchesFilter(doc.metadata, filter)) {
        continue;
      }

      const score = cosineSimilarity(queryVector, doc.embedding);
      results.push({
        id: doc.id,
        content: doc.content,
        score,
        metadata: doc.metadata,
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  async remove(collectionName: string, ids: string[]): Promise<void> {
    const collection = this.getCollection(collectionName);
    for (const id of ids) {
      collection.documents.delete(id);
    }
    logger.debug(`Removed ${ids.length} documents from "${collectionName}"`);
  }

  private getCollection(name: string): CollectionMeta {
    const collection = this.collections.get(name);
    if (!collection) {
      throw new Error(`Collection "${name}" does not exist`);
    }
    return collection;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (normA * normB);
}

function matchesFilter(metadata: Record<string, unknown>, filter: VectorFilter): boolean {
  for (const [key, value] of Object.entries(filter)) {
    const metaValue = metadata[key];

    if (Array.isArray(value)) {
      // Array filter: metadata value must be one of the specified values
      if (!value.includes(metaValue as string)) {
        return false;
      }
    } else {
      // Exact match
      if (metaValue !== value) {
        return false;
      }
    }
  }
  return true;
}
