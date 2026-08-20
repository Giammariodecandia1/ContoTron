import { supabase } from './supabaseClient';

const FUNCTION_NAME = 'google-drive-token';
const messageFromError = (error: unknown) => error instanceof Error ? error.message : 'Servizio Google Drive non disponibile.';

export const saveGoogleDriveRefreshToken = async (refreshToken: string) => {
  if (!refreshToken.trim()) return;
  const { error } = await supabase.functions.invoke(FUNCTION_NAME, { body: { action: 'store_refresh_token', refreshToken } });
  if (error) throw new Error(messageFromError(error));
};

export const getGoogleDriveServerAccessToken = async () => {
  const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, { body: { action: 'get_access_token' } });
  if (error) throw new Error(messageFromError(error));
  const accessToken = data && typeof data === 'object' ? (data as { accessToken?: unknown }).accessToken : null;
  if (typeof accessToken !== 'string' || !accessToken) throw new Error('Google Drive non ha restituito un accesso valido.');
  return accessToken;
};
