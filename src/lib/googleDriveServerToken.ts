import { supabase } from './supabaseClient';

const FUNCTION_NAME = 'google-drive-token';
const messageFromError = (error: unknown) => error instanceof Error ? error.message : 'Servizio Google Drive non disponibile.';
let cachedAccessToken: { value: string; expiresAt: number } | null = null;

export const saveGoogleDriveRefreshToken = async (refreshToken: string) => {
  if (!refreshToken.trim()) return;
  const { error } = await supabase.functions.invoke(FUNCTION_NAME, { body: { action: 'store_refresh_token', refreshToken } });
  if (error) throw new Error(messageFromError(error));
  cachedAccessToken = null;
};

export const clearGoogleDriveServerAccessTokenCache = () => {
  cachedAccessToken = null;
};

export const getGoogleDriveServerAccessToken = async (forceRefresh = false) => {
  if (!forceRefresh && cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) {
    return cachedAccessToken.value;
  }
  const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, { body: { action: 'get_access_token' } });
  if (error) throw new Error(messageFromError(error));
  const payload = data && typeof data === 'object'
    ? data as { accessToken?: unknown; expiresIn?: unknown }
    : null;
  const accessToken = payload?.accessToken;
  if (typeof accessToken !== 'string' || !accessToken) throw new Error('Google Drive non ha restituito un accesso valido.');
  const expiresIn = typeof payload?.expiresIn === 'number' ? payload.expiresIn : 3600;
  cachedAccessToken = {
    value: accessToken,
    expiresAt: Date.now() + Math.max(60, expiresIn - 120) * 1000,
  };
  return accessToken;
};
