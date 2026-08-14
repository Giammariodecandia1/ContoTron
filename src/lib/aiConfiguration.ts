export interface AiConfiguration {
  apiKey: string;
  endpoint: string;
  model: string;
  validatedAt: string;
}

export type AiConfigurationDraft = Omit<AiConfiguration, 'validatedAt'>;

export const DEFAULT_AI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
export const DEFAULT_AI_MODEL = 'gemini-3.5-flash-lite';

export const createDefaultAiDraft = (apiKey = ''): AiConfigurationDraft => ({
  apiKey,
  endpoint: DEFAULT_AI_ENDPOINT,
  model: DEFAULT_AI_MODEL,
});

const AI_CONFIGURATION_EVENT = 'contotron-ai-configuration-changed';
const STORAGE_PREFIX = 'contotron:ai-configuration:';

const storageKey = (userId: string) => `${STORAGE_PREFIX}${userId}`;

export const resolveAiChatEndpoint = (endpoint: string) => {
  const normalized = endpoint.trim().replace(/\/+$/, '');
  if (!normalized) return '';
  if (/\/chat\/completions$/i.test(normalized)) return normalized;
  if (/\/(?:api\/)?v1$/i.test(normalized)) return `${normalized}/chat/completions`;
  return `${normalized}/v1/chat/completions`;
};

const isValidConfiguration = (value: unknown): value is AiConfiguration => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AiConfiguration>;
  return typeof candidate.apiKey === 'string'
    && candidate.apiKey.trim().length > 0
    && typeof candidate.endpoint === 'string'
    && candidate.endpoint.trim().length > 0
    && typeof candidate.model === 'string'
    && candidate.model.trim().length > 0
    && typeof candidate.validatedAt === 'string';
};

export const getAiConfiguration = (userId: string | null | undefined): AiConfiguration | null => {
  if (!userId || typeof window === 'undefined') return null;
  try {
    const saved = window.localStorage.getItem(storageKey(userId));
    if (!saved) return null;
    const parsed: unknown = JSON.parse(saved);
    return isValidConfiguration(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const announceConfigurationChange = (userId: string) => {
  window.dispatchEvent(new CustomEvent(AI_CONFIGURATION_EVENT, { detail: { userId } }));
};

export const saveAiConfiguration = (userId: string, draft: AiConfigurationDraft): AiConfiguration => {
  const configuration: AiConfiguration = {
    apiKey: draft.apiKey.trim(),
    endpoint: resolveAiChatEndpoint(draft.endpoint),
    model: draft.model.trim(),
    validatedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(storageKey(userId), JSON.stringify(configuration));
  announceConfigurationChange(userId);
  return configuration;
};

export const clearAiConfiguration = (userId: string) => {
  window.localStorage.removeItem(storageKey(userId));
  announceConfigurationChange(userId);
};

export const subscribeToAiConfiguration = (listener: () => void) => {
  const onConfigurationChange = () => listener();
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith(STORAGE_PREFIX)) listener();
  };
  window.addEventListener(AI_CONFIGURATION_EVENT, onConfigurationChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(AI_CONFIGURATION_EVENT, onConfigurationChange);
    window.removeEventListener('storage', onStorage);
  };
};
