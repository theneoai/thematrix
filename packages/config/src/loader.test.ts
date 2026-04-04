import { describe, it, expect } from 'vitest';
import { validateAgentDefinition, validateWorkflowDefinition, ConfigValidationError } from './loader.js';

describe('config loader', () => {
  describe('validateAgentDefinition', () => {
    it('should validate a correct agent definition', () => {
      const validAgent = {
        id: 'test-agent',
        name: 'Test Agent',
        version: '1.0.0',
        persona: {
          systemPrompt: 'You are a test agent.',
          personality: 'helpful',
          role: 'assistant',
          traits: {},
        },
        model: {
          provider: 'mock',
          model: 'mock-model',
        },
        skills: [],
        tools: [],
        memory: {
          persistHistory: true,
          maxHistoryTurns: 50,
          scopes: [{ scope: 'agent-local', access: 'read-write' }],
        },
        maxConcurrency: 1,
        turnTimeoutMs: 60000,
        metadata: {},
      };

      const result = validateAgentDefinition(validAgent);
      expect(result.success).toBe(true);
    });

    it('should fail validation for invalid agent definition', () => {
      const invalidAgent = {
        id: 'test-agent',
        // missing required fields
      };

      const result = validateAgentDefinition(invalidAgent);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });
  });

  describe('validateWorkflowDefinition', () => {
    it('should validate a correct DAG workflow', () => {
      const validWorkflow = {
        id: 'test-workflow',
        name: 'Test Workflow',
        version: '1.0.0',
        mode: 'dag',
        agents: {
          agent1: { ref: './agent.yaml' },
        },
        dag: {
          nodes: [
            { id: 'node1', agentId: 'agent1', type: 'task' },
          ],
          edges: [],
        },
        sharedMemory: {
          kvStore: 'in-memory',
          persistent: false,
        },
      };

      const result = validateWorkflowDefinition(validWorkflow);
      expect(result.success).toBe(true);
    });

    it('should validate a correct state-machine workflow', () => {
      const validWorkflow = {
        id: 'test-workflow',
        name: 'Test Workflow',
        version: '1.0.0',
        mode: 'state-machine',
        agents: {
          agent1: { ref: './agent.yaml' },
        },
        stateMachine: {
          initialState: 'start',
          states: {
            start: { type: 'succeed' },
          },
        },
        sharedMemory: {
          kvStore: 'in-memory',
          persistent: false,
        },
      };

      const result = validateWorkflowDefinition(validWorkflow);
      expect(result.success).toBe(true);
    });

    it('should fail validation for workflow without dag or stateMachine', () => {
      const invalidWorkflow = {
        id: 'test-workflow',
        name: 'Test Workflow',
        version: '1.0.0',
        mode: 'dag',
        agents: {},
        sharedMemory: {
          kvStore: 'in-memory',
          persistent: false,
        },
      };

      const result = validateWorkflowDefinition(invalidWorkflow);
      expect(result.success).toBe(false);
    });
  });
});
