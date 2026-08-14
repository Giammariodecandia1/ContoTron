import {
  resolveAiChatEndpoint,
  type AiConfigurationDraft,
} from './aiConfiguration';

export type AiMessageContent = string | Array<{
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}>;

export interface AiToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: AiMessageContent | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: AiToolCall[];
}

export interface AiToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string | Array<{ type?: string; text?: string }> | null;
      tool_calls?: AiToolCall[];
    };
  }>;
  error?: { message?: string };
}

export class AiConnectionError extends Error {}

const delay = (milliseconds: number) => new Promise(resolve => window.setTimeout(resolve, milliseconds));

const readTextContent = (content: string | Array<{ type?: string; text?: string }> | null | undefined) => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(part => part.text || '').join('\n').trim();
  return '';
};

export const requestAiChatCompletion = async ({
  configuration,
  messages,
  tools,
  maxTokens = 900,
  timeoutMs = 60_000,
}: {
  configuration: AiConfigurationDraft;
  messages: AiChatMessage[];
  tools?: AiToolDefinition[];
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<AiChatMessage> => {
  const endpoint = resolveAiChatEndpoint(configuration.endpoint);
  if (!endpoint || !configuration.apiKey.trim() || !configuration.model.trim()) {
    throw new AiConnectionError('Configurazione AI incompleta.');
  }
  try {
    const url = new URL(endpoint);
    const localHttp = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
    if (url.protocol !== 'https:' && !localHttp) {
      throw new Error('protocollo non sicuro');
    }
  } catch {
    throw new AiConnectionError('Endpoint non valido. Usa un indirizzo HTTPS completo.');
  }

  const body: Record<string, unknown> = {
    model: configuration.model.trim(),
    messages,
    max_tokens: maxTokens,
    stream: false,
  };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${configuration.apiKey.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      let payload: ChatCompletionResponse = {};
      try {
        payload = await response.json() as ChatCompletionResponse;
      } catch {
        // Some compatible endpoints return an empty body on network/proxy errors.
      }

      if (!response.ok) {
        const detail = payload.error?.message || `Errore HTTP ${response.status}`;
        if ((response.status === 429 || response.status >= 500) && attempt < 3) {
          lastError = new AiConnectionError(detail);
          await delay(1000 * (2 ** attempt));
          continue;
        }
        throw new AiConnectionError(detail);
      }

      const responseMessage = payload.choices?.[0]?.message;
      if (!responseMessage) throw new AiConnectionError('Il servizio AI non ha restituito una risposta valida.');
      return {
        role: 'assistant',
        content: readTextContent(responseMessage.content),
        tool_calls: responseMessage.tool_calls,
      };
    } catch (error) {
      if (error instanceof AiConnectionError) throw error;
      lastError = error;
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new AiConnectionError('Il servizio AI non ha risposto entro il tempo previsto.');
      }
      if (attempt < 3) {
        await delay(1000 * (2 ** attempt));
        continue;
      }
    } finally {
      window.clearTimeout(timeout);
    }
  }

  console.warn('Collegamento AI fallito:', lastError);
  throw new AiConnectionError('Collegamento non riuscito. Controlla endpoint, CORS, modello e chiave API.');
};

export const testAiConnection = async (configuration: AiConfigurationDraft) => {
  const response = await requestAiChatCompletion({
    configuration,
    messages: [
      { role: 'system', content: 'Rispondi in modo conciso. Sei il test di collegamento di Contotron.' },
      { role: 'user', content: 'Rispondi soltanto con la parola OK.' },
    ],
    maxTokens: 12,
    timeoutMs: 30_000,
  });
  if (!response.content) throw new AiConnectionError('Connessione avvenuta, ma il modello non ha restituito testo.');
};
