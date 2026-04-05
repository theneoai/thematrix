/**
 * 所有 Provider 插件定义
 *
 * 支持 12+ Provider，包括 OpenClaw 支持的所有主要 Provider
 */

import type { ProviderPlugin, ModelInfo } from '@thematrix/types';
import { createOpenAICompatiblePlugin } from './base.js';
import { anthropicPlugin } from './anthropic.js';
import { opencodePlugin } from './opencode.js';
import { kimicodePlugin } from './kimi.js';

// ============================================================
// OpenAI
// ============================================================

export const openaiPlugin = createOpenAICompatiblePlugin({
  name: 'openai',
  displayName: 'OpenAI',
  defaultBaseUrl: 'https://api.openai.com',
  defaultModel: 'gpt-4o',
  models: [
    { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000, maxOutputTokens: 16384, inputPricePerMToken: 2.5, outputPricePerMToken: 10, capabilities: ['chat', 'tool-calling', 'vision', 'streaming', 'json-mode'] },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', contextWindow: 128000, maxOutputTokens: 16384, inputPricePerMToken: 0.15, outputPricePerMToken: 0.6, capabilities: ['chat', 'tool-calling', 'vision', 'streaming', 'json-mode'] },
    { id: 'o3-mini', name: 'o3-mini', contextWindow: 200000, maxOutputTokens: 100000, inputPricePerMToken: 1.1, outputPricePerMToken: 4.4, capabilities: ['chat', 'tool-calling', 'streaming'] },
  ],
});

// ============================================================
// Azure OpenAI
// ============================================================

export const azureOpenaiPlugin = createOpenAICompatiblePlugin({
  name: 'azure-openai',
  displayName: 'Azure OpenAI',
  defaultBaseUrl: 'https://YOUR_RESOURCE.openai.azure.com',
  defaultModel: 'gpt-4o',
  models: [
    { id: 'gpt-4o', name: 'GPT-4o (Azure)', contextWindow: 128000, maxOutputTokens: 16384, capabilities: ['chat', 'tool-calling', 'vision', 'streaming'] },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Azure)', contextWindow: 128000, maxOutputTokens: 16384, capabilities: ['chat', 'tool-calling', 'streaming'] },
  ],
});

// ============================================================
// Google Gemini
// ============================================================

export const googleGeminiPlugin = createOpenAICompatiblePlugin({
  name: 'google-gemini',
  displayName: 'Google Gemini',
  defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  defaultModel: 'gemini-2.0-flash',
  models: [
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: 1048576, maxOutputTokens: 65536, inputPricePerMToken: 1.25, outputPricePerMToken: 10, capabilities: ['chat', 'tool-calling', 'vision', 'streaming'] },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', contextWindow: 1048576, maxOutputTokens: 8192, inputPricePerMToken: 0.1, outputPricePerMToken: 0.4, capabilities: ['chat', 'tool-calling', 'vision', 'streaming'] },
  ],
});

// ============================================================
// DeepSeek
// ============================================================

export const deepseekPlugin = createOpenAICompatiblePlugin({
  name: 'deepseek',
  displayName: 'DeepSeek',
  defaultBaseUrl: 'https://api.deepseek.com',
  defaultModel: 'deepseek-chat',
  models: [
    { id: 'deepseek-chat', name: 'DeepSeek Chat (V3)', contextWindow: 64000, maxOutputTokens: 8192, inputPricePerMToken: 0.27, outputPricePerMToken: 1.1, capabilities: ['chat', 'tool-calling', 'streaming', 'json-mode'] },
    { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner (R1)', contextWindow: 64000, maxOutputTokens: 8192, inputPricePerMToken: 0.55, outputPricePerMToken: 2.19, capabilities: ['chat', 'streaming'] },
  ],
});

// ============================================================
// Ollama (本地模型)
// ============================================================

export const ollamaPlugin = createOpenAICompatiblePlugin({
  name: 'ollama',
  displayName: 'Ollama (Local)',
  defaultBaseUrl: 'http://localhost:11434',
  defaultModel: 'llama3',
  models: [
    { id: 'llama3', name: 'Llama 3', contextWindow: 8192, maxOutputTokens: 4096, capabilities: ['chat', 'streaming'] },
    { id: 'llama3:70b', name: 'Llama 3 70B', contextWindow: 8192, maxOutputTokens: 4096, capabilities: ['chat', 'streaming'] },
    { id: 'codellama', name: 'Code Llama', contextWindow: 16384, maxOutputTokens: 4096, capabilities: ['chat', 'completion', 'streaming'] },
    { id: 'qwen2.5-coder', name: 'Qwen 2.5 Coder', contextWindow: 32768, maxOutputTokens: 8192, capabilities: ['chat', 'streaming'] },
    { id: 'deepseek-r1', name: 'DeepSeek R1 (Local)', contextWindow: 64000, maxOutputTokens: 8192, capabilities: ['chat', 'streaming'] },
  ],
});

// ============================================================
// vLLM (自部署推理)
// ============================================================

export const vllmPlugin = createOpenAICompatiblePlugin({
  name: 'vllm',
  displayName: 'vLLM (Self-hosted)',
  defaultBaseUrl: 'http://localhost:8000',
  defaultModel: 'default',
  models: [
    { id: 'default', name: 'vLLM Default Model', contextWindow: 32768, maxOutputTokens: 8192, capabilities: ['chat', 'completion', 'streaming'] },
  ],
});

// ============================================================
// OpenRouter (200+ models)
// ============================================================

export const openrouterPlugin = createOpenAICompatiblePlugin({
  name: 'openrouter',
  displayName: 'OpenRouter',
  defaultBaseUrl: 'https://openrouter.ai/api',
  defaultModel: 'anthropic/claude-sonnet-4',
  models: [
    { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4 (via OpenRouter)', contextWindow: 200000, maxOutputTokens: 64000, capabilities: ['chat', 'tool-calling', 'streaming'] },
    { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro (via OpenRouter)', contextWindow: 1048576, maxOutputTokens: 65536, capabilities: ['chat', 'tool-calling', 'streaming'] },
    { id: 'meta-llama/llama-3.3-70b', name: 'Llama 3.3 70B (via OpenRouter)', contextWindow: 128000, maxOutputTokens: 8192, capabilities: ['chat', 'streaming'] },
  ],
});

// ============================================================
// Moonshot / Kimi
// ============================================================

export const moonshotPlugin = createOpenAICompatiblePlugin({
  name: 'moonshot',
  displayName: 'Moonshot (Kimi)',
  defaultBaseUrl: 'https://api.moonshot.cn',
  defaultModel: 'moonshot-v1-8k',
  models: [
    { id: 'moonshot-v1-8k', name: 'Moonshot V1 8K', contextWindow: 8192, maxOutputTokens: 4096, inputPricePerMToken: 0.8, outputPricePerMToken: 0.8, capabilities: ['chat', 'tool-calling', 'streaming'] },
    { id: 'moonshot-v1-32k', name: 'Moonshot V1 32K', contextWindow: 32768, maxOutputTokens: 8192, inputPricePerMToken: 1.7, outputPricePerMToken: 1.7, capabilities: ['chat', 'tool-calling', 'streaming'] },
    { id: 'moonshot-v1-128k', name: 'Moonshot V1 128K', contextWindow: 131072, maxOutputTokens: 8192, inputPricePerMToken: 4.3, outputPricePerMToken: 4.3, capabilities: ['chat', 'tool-calling', 'streaming'] },
  ],
});

// ============================================================
// MiniMax
// ============================================================

export const minimaxPlugin = createOpenAICompatiblePlugin({
  name: 'minimax',
  displayName: 'MiniMax',
  defaultBaseUrl: 'https://api.minimax.chat',
  defaultModel: 'abab6.5s-chat',
  models: [
    { id: 'abab6.5s-chat', name: 'ABAB 6.5s', contextWindow: 245760, maxOutputTokens: 8192, inputPricePerMToken: 0.7, outputPricePerMToken: 0.7, capabilities: ['chat', 'tool-calling', 'streaming'] },
    { id: 'abab6.5g-chat', name: 'ABAB 6.5g', contextWindow: 8192, maxOutputTokens: 4096, inputPricePerMToken: 0.14, outputPricePerMToken: 0.14, capabilities: ['chat', 'streaming'] },
  ],
});

// ============================================================
// Alibaba Qwen
// ============================================================

export const qwenPlugin = createOpenAICompatiblePlugin({
  name: 'qwen',
  displayName: 'Alibaba Qwen',
  defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode',
  defaultModel: 'qwen-max',
  models: [
    { id: 'qwen-max', name: 'Qwen Max', contextWindow: 32768, maxOutputTokens: 8192, inputPricePerMToken: 2.8, outputPricePerMToken: 11.2, capabilities: ['chat', 'tool-calling', 'streaming'] },
    { id: 'qwen-plus', name: 'Qwen Plus', contextWindow: 131072, maxOutputTokens: 8192, inputPricePerMToken: 0.56, outputPricePerMToken: 2.24, capabilities: ['chat', 'tool-calling', 'streaming'] },
    { id: 'qwen-turbo', name: 'Qwen Turbo', contextWindow: 131072, maxOutputTokens: 8192, inputPricePerMToken: 0.04, outputPricePerMToken: 0.16, capabilities: ['chat', 'streaming'] },
    { id: 'qwen-coder-plus', name: 'Qwen Coder Plus', contextWindow: 131072, maxOutputTokens: 8192, inputPricePerMToken: 0.5, outputPricePerMToken: 2.0, capabilities: ['chat', 'streaming'] },
  ],
});

// ============================================================
// Hugging Face Inference API
// ============================================================

export const huggingfacePlugin = createOpenAICompatiblePlugin({
  name: 'huggingface',
  displayName: 'Hugging Face',
  defaultBaseUrl: 'https://api-inference.huggingface.co',
  defaultModel: 'meta-llama/Llama-3-8b-chat-hf',
  models: [
    { id: 'meta-llama/Llama-3-8b-chat-hf', name: 'Llama 3 8B (HF)', contextWindow: 8192, maxOutputTokens: 4096, capabilities: ['chat', 'streaming'] },
  ],
});

// ============================================================
// 所有内置 Provider 列表
// ============================================================

export { anthropicPlugin } from './anthropic.js';
export { opencodePlugin } from './opencode.js';
export { kimicodePlugin } from './kimi.js';

export const allProviderPlugins: ProviderPlugin[] = [
  openaiPlugin,
  anthropicPlugin,
  azureOpenaiPlugin,
  googleGeminiPlugin,
  deepseekPlugin,
  ollamaPlugin,
  vllmPlugin,
  openrouterPlugin,
  moonshotPlugin,
  minimaxPlugin,
  qwenPlugin,
  huggingfacePlugin,
  opencodePlugin,
  kimicodePlugin,
];
