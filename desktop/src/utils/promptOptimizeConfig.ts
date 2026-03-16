export type PromptOptimizeMode = 'off' | 'text' | 'json';

export interface SyncedChatConfig {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  timeoutSeconds: number;
}

export type PromptOptimizeConfigIssue = 'missing' | 'unsynced' | 'unsupported' | null;

interface PromptOptimizeConfigInput {
  mode?: string | null;
  chatProvider: string;
  chatApiBaseUrl: string;
  chatApiKey: string;
  chatModel: string;
  chatTimeoutSeconds?: number;
  chatSyncedConfig?: SyncedChatConfig | null;
  requireSynced?: boolean;
}

export const isPromptOptimizeEnabled = (mode?: string | null) =>
  String(mode || '').trim().toLowerCase() !== '' && String(mode || '').trim().toLowerCase() !== 'off';

export const buildChatConfigSignature = (base: string, key: string, model: string, timeoutSeconds?: number) =>
  `${base.trim()}::${key.trim()}::${model.trim()}::${timeoutSeconds ?? ''}`;

export const getPromptOptimizeConfigIssue = ({
  mode,
  chatProvider,
  chatApiBaseUrl,
  chatApiKey,
  chatModel,
  chatTimeoutSeconds,
  chatSyncedConfig,
  requireSynced = false
}: PromptOptimizeConfigInput): PromptOptimizeConfigIssue => {
  if (!isPromptOptimizeEnabled(mode)) {
    return null;
  }

  const chatBase = chatApiBaseUrl.trim();
  const chatKey = chatApiKey.trim();
  const chatModelValue = chatModel.trim();
  const normalizedProvider = String(chatProvider || '').trim().toLowerCase();

  if (!chatBase || !chatKey || !chatModelValue) {
    return 'missing';
  }

  if (
    normalizedProvider === 'openai-chat' &&
    chatModelValue.toLowerCase().startsWith('gemini') &&
    chatBase.includes('api.openai.com')
  ) {
    return 'unsupported';
  }

  if (requireSynced) {
    if (!chatSyncedConfig) {
      return 'unsynced';
    }
    const currentSignature = buildChatConfigSignature(chatBase, chatKey, chatModelValue, chatTimeoutSeconds);
    const syncedSignature = buildChatConfigSignature(
      chatSyncedConfig.apiBaseUrl,
      chatSyncedConfig.apiKey,
      chatSyncedConfig.model,
      chatSyncedConfig.timeoutSeconds
    );
    if (currentSignature !== syncedSignature) {
      return 'unsynced';
    }
  }

  return null;
};
