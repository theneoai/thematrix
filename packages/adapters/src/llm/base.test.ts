import { describe, it, expect } from 'vitest';
import { MockLLMAdapter, estimateTokenCount, adapterFactory } from './base.js';

describe('MockLLMAdapter', () => {
  const adapter = new MockLLMAdapter();

  describe('chat', () => {
    it('should return a mock response', async () => {
      const response = await adapter.chat({
        model: 'mock-model',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(response.id).toBeDefined();
      expect(response.model).toBe('mock-model');
      expect(response.content).toContain('Mock response');
      expect(response.usage.totalTokens).toBeGreaterThan(0);
    });

    it('should include message content in response', async () => {
      const response = await adapter.chat({
        model: 'mock-model',
        messages: [{ role: 'user', content: 'Test message' }],
      });

      expect(response.content).toContain('Test message');
    });
  });

  describe('chatStream', () => {
    it('should yield chunks', async () => {
      const chunks = [];
      for await (const chunk of adapter.chatStream({
        model: 'mock-model',
        messages: [{ role: 'user', content: 'Hello' }],
      })) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
    });
  });

  describe('countTokens', () => {
    it('should estimate tokens', async () => {
      const tokens = await adapter.countTokens('Hello world');
      expect(tokens).toBeGreaterThan(0);
    });
  });
});

describe('estimateTokenCount', () => {
  it('should estimate based on character count', () => {
    const tokens = estimateTokenCount('Hello world');
    expect(tokens).toBe(3); // 11 chars / 4 = 2.75 -> 3
  });

  it('should handle empty string', () => {
    const tokens = estimateTokenCount('');
    expect(tokens).toBe(0);
  });
});

describe('adapterFactory', () => {
  it('should create mock adapter', () => {
    const adapter = adapterFactory.create('mock');
    expect(adapter.provider).toBe('mock');
  });

  it('should throw for unregistered provider', () => {
    expect(() => adapterFactory.create('unknown')).toThrow('No adapter registered');
  });

  it('should list registered providers', () => {
    const providers = adapterFactory.getRegisteredProviders();
    expect(providers).toContain('mock');
  });
});
