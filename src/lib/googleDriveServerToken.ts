import { supabase } from './supabaseClient';

const FUNCTION_NAME = 'google-drive-token';
const messageFromError = async (error: unknown) => {
  const context = error && typeof error === 'object' && 'context' in error
    ? (error as { context?: unknown }).context
    : null;
  if (context instanceof Response) {
    try {
      const payload = await context.clone().json() as { error?: unknown };
      if (typeof payload.error === 'string' && payload.error) return payload.error;
    } catch {
      // Mantiene il messaggio originale quando la risposta non contiene JSON.
    }
  }
  return error instanceof Error ? error.message : 'Servizio Google Drive non disponibile.';
};
let cachedAccessToken: { userId: string; value: string; expiresAt: number } | null = null;

export const saveGoogleDriveRefreshToken = async (refreshToken: string) => {
  if (!refreshToken.trim()) return;
  const storeToken = () => supabase.functions.invoke(FUNCTION_NAME, {
    body: { action: 'store_refresh_token', refreshToken },
  });
  let result = await storeToken();
  if (result.error) {
    // Subito dopo il ritorno OAuth il JWT dell'app puo essere ancora in fase di
    // aggiornamento. Rinnova la sessione e riprova una sola volta.
    const { error: refreshError } = await supabase.auth.refreshSession();
    if (!refreshError) result = await storeToken();
  }
  if (result.error) throw new Error(await messageFromError(result.error));
  cachedAccessToken = null;
};

export const clearGoogleDriveServerAccessTokenCache = () => {
  cachedAccessToken = null;
};

export const getGoogleDriveServerAccessToken = async (forceRefresh = false) => {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id || null;
  if (!userId) throw new Error('Sessione Contotron non disponibile per Google Drive.');
  if (
    !forceRefresh
    && cachedAccessToken
    && cachedAccessToken.userId === userId
    && cachedAccessToken.expiresAt > Date.now()
  ) {
    return cachedAccessToken.value;
  }
  const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, { body: { action: 'get_access_token' } });
  if (error) throw new Error(await messageFromError(error));
  const payload = data && typeof data === 'object'
    ? data as { accessToken?: unknown; expiresIn?: unknown }
    : null;
  const accessToken = payload?.accessToken;
  if (typeof accessToken !== 'string' || !accessToken) throw new Error('Google Drive non ha restituito un accesso valido.');
  const expiresIn = typeof payload?.expiresIn === 'number' ? payload.expiresIn : 3600;
  cachedAccessToken = {
    userId,
    value: accessToken,
    expiresAt: Date.now() + Math.max(60, expiresIn - 120) * 1000,
  };
  return accessToken;
};
