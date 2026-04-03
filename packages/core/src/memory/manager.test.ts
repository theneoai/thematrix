import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryManager } from './manager.js';

describe('MemoryManager', () => {
  let memory: MemoryManager;

  beforeEach(() => {
    memory = new MemoryManager({ dbPath: ':memory:' });
  });

  afterEach(() => {
    memory.close();
  });

  describe('KV Store', () => {
    it('should set and get a value', async () => {
      await memory.set('agent-local', 'agent-1', 'key1', 'value1');
      const value = await memory.get('agent-local', 'agent-1', 'key1');
      expect(value).toBe('value1');
    });

    it('should return undefined for non-existent key', async () => {
      const value = await memory.get('agent-local', 'agent-1', 'nonexistent');
      expect(value).toBeUndefined();
    });

    it('should delete a key', async () => {
      await memory.set('agent-local', 'agent-1', 'key1', 'value1');
      const deleted = await memory.delete('agent-local', 'agent-1', 'key1');
      expect(deleted).toBe(true);

      const value = await memory.get('agent-local', 'agent-1', 'key1');
      expect(value).toBeUndefined();
    });

    it('should list keys by prefix', async () => {
      await memory.set('agent-local', 'agent-1', 'prefix:key1', 'value1');
      await memory.set('agent-local', 'agent-1', 'prefix:key2', 'value2');
      await memory.set('agent-local', 'agent-1', 'other:key', 'value3');

      const entries = await memory.list('agent-local', 'agent-1', 'prefix:');
      expect(entries.length).toBe(2);
      expect(entries.map(e => e.key)).toContain('prefix:key1');
      expect(entries.map(e => e.key)).toContain('prefix:key2');
    });

    it('should respect scope isolation', async () => {
      await memory.set('agent-local', 'agent-1', 'key1', 'value1');
      await memory.set('workflow-shared', 'wf-1', 'key1', 'value2');

      const value1 = await memory.get('agent-local', 'agent-1', 'key1');
      const value2 = await memory.get('workflow-shared', 'wf-1', 'key1');

      expect(value1).toBe('value1');
      expect(value2).toBe('value2');
    });
  });

  describe('Conversation History', () => {
    it('should append and retrieve turns', async () => {
      const turn = {
        turnId: 'turn-1',
        role: 'user' as const,
        content: 'Hello',
        timestamp: new Date(),
      };

      await memory.appendTurn('agent-1', turn);
      const history = await memory.getHistory('agent-1');

      expect(history.length).toBe(1);
      expect(history[0].content).toBe('Hello');
    });

    it('should return history in chronological order', async () => {
      await memory.appendTurn('agent-1', {
        turnId: 'turn-1',
        role: 'user',
        content: 'First',
        timestamp: new Date('2024-01-01'),
      });
      await memory.appendTurn('agent-1', {
        turnId: 'turn-2',
        role: 'assistant',
        content: 'Second',
        timestamp: new Date('2024-01-02'),
      });

      const history = await memory.getHistory('agent-1');
      expect(history[0].content).toBe('First');
      expect(history[1].content).toBe('Second');
    });

    it('should clear history', async () => {
      await memory.appendTurn('agent-1', {
        turnId: 'turn-1',
        role: 'user',
        content: 'Hello',
        timestamp: new Date(),
      });

      await memory.clearHistory('agent-1');
      const history = await memory.getHistory('agent-1');
      expect(history.length).toBe(0);
    });
  });
});
