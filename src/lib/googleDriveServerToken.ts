import { supabase } from './supabaseClient';
import { GoogleDriveAuthError, googleDriveServerError } from './googleDriveErrors';

const FUNCTION_NAME = 'google-drive-token';
let cachedAccessToken: { userId: string; value: string; expiresAt: number } | null = null;
const SESSION_REFRESH_SAFETY_WINDOW_MS = 2 * 60 * 1000;

const getSessionReadyForServerRequest = async () => {
  const { data: initialData } = await supabase.auth.getSession();
  const initialSession = initialData.session;
  if (!initialSession) throw new Error('Sessione Contotron non disponibile per Google Drive.');

  // Il browser puo restare aperto per molte ore. Rinnova il JWT prima che
  // scada, cosi la Edge Function puo sempre leggere il refresh token Drive.
  const expiresAt = Number(initialSession.expires_at || 0) * 1000;
  if (!expiresAt || expiresAt - Date.now() > SESSION_REFRESH_SAFETY_WINDOW_MS) return initialSession;

  const { data, error } = await supabase.auth.refreshSession();
  if (error || !data.session) {
    throw new Error('Sessione Contotron scaduta: accedi di nuovo per ricollegare Google Drive.');
  }
  return data.session;
};

const invokeDrive = async (body: { action: string; refreshToken?: string }) => {
  const session = await getSessionReadyForServerRequest();
  const invoke = (jwt: string) => supabase.functions.invoke(FUNCTION_NAME, {
    headers: { Authorization: `Bearer ${jwt}` },
    body,
  });
  let result = await invoke(session.access_token);
  // Refresh the app session only for authentication failures, not for a
  // missing Google credential or server configuration problem.
  if (result.error?.context instanceof Response && result.error.context.status === 401) {
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data.session) result = await invoke(data.session.access_token);
  }
  if (result.error) throw await googleDriveServerError(result.error);
  return result.data;
};

export const saveGoogleDriveRefreshToken = async (refreshToken: string) => {
  if (!refreshToken.trim()) return;
  await invokeDrive({ action: 'store_refresh_token', refreshToken });
  cachedAccessToken = null;
};

export const clearGoogleDriveServerAccessTokenCache = () => {
  cachedAccessToken = null;
};

export const getGoogleDriveServerAccessToken = async (forceRefresh = false) => {
  const session = await getSessionReadyForServerRequest();
  const userId = session.user.id;
  if (
    !forceRefresh
    && cachedAccessToken
    && cachedAccessToken.userId === userId
    && cachedAccessToken.expiresAt > Date.now()
  ) {
    return cachedAccessToken.value;
  }
  let data;
  try {
    data = await invokeDrive({ action: 'get_access_token' });
  } catch (error) {
    // Repair a failed OAuth callback deposit while its Google refresh token
    // is still available. Never replace a saved grant on a service failure.
    if (!(error instanceof GoogleDriveAuthError) || !session.provider_refresh_token) throw error;
    await saveGoogleDriveRefreshToken(session.provider_refresh_token);
    data = await invokeDrive({ action: 'get_access_token' });
  }
  const payload = data && typeof data === 'object'
    ? data as { accessToken?: unknown; expiresIn?: unknown }
    : null;
  const accessToken = payload?.accessToken;
  if (typeof accessToken !== 'string' || !accessToken) throw new Error('Google Drive non ha restituito un accesso valido.');
  const expiresIn = typeof payload?.expiresIn === 'number' ? payload.expiresIn : 3600;
  cachedAccessToken = {
    userId,
    value: accessToken,
    expiresAt: Date.now() + Math.max(0, expiresIn - 120) * 1000,
  };
  return accessToken;
};
