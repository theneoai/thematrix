import { describe, it, expect } from 'vitest';
import { generateId, generateAgentInstanceId, generateWorkflowRunId, generateEventId, generateMessageId } from './id.js';

describe('id generation', () => {
  describe('generateId', () => {
    it('should generate a unique ULID', () => {
      const id1 = generateId();
      const id2 = generateId();
      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
      expect(id1.length).toBe(26);
    });
  });

  describe('generateAgentInstanceId', () => {
    it('should generate an ID with agent- prefix', () => {
      const id = generateAgentInstanceId();
      expect(id.startsWith('agent-')).toBe(true);
      expect(id.length).toBe(32);
    });
  });

  describe('generateWorkflowRunId', () => {
    it('should generate an ID with wf- prefix', () => {
      const id = generateWorkflowRunId();
      expect(id.startsWith('wf-')).toBe(true);
      expect(id.length).toBe(29);
    });
  });

  describe('generateEventId', () => {
    it('should generate an ID with evt- prefix', () => {
      const id = generateEventId();
      expect(id.startsWith('evt-')).toBe(true);
      expect(id.length).toBe(30);
    });
  });

  describe('generateMessageId', () => {
    it('should generate an ID with msg- prefix', () => {
      const id = generateMessageId();
      expect(id.startsWith('msg-')).toBe(true);
      expect(id.length).toBe(30);
    });
  });
});
