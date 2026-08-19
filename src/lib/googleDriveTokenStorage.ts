const TOKEN_KEY_PREFIX = 'contotron_google_drive_token_';
const TOKEN_LIFETIME_MS = 50 * 60 * 1000;
const CONNECTION_INTENT_KEY = 'contotron_google_drive_connection_requested';
const CONNECTION_INTENT_LIFETIME_MS = 15 * 60 * 1000;

interface StoredGoogleDriveToken {
  accessToken: string;
  expiresAt: number;
}

const tokenKey = (userId: string) => `${TOKEN_KEY_PREFIX}${userId}`;

export const saveGoogleDriveAccessToken = (userId: string, accessToken: string) => {
  if (!userId || !accessToken) return;
  const stored: StoredGoogleDriveToken = {
    accessToken,
    expiresAt: Date.now() + TOKEN_LIFETIME_MS,
  };
  localStorage.setItem(tokenKey(userId), JSON.stringify(stored));
};

export const readGoogleDriveAccessToken = (userId: string) => {
  if (!userId) return null;
  const raw = localStorage.getItem(tokenKey(userId));
  if (!raw) return null;

  try {
    const stored = JSON.parse(raw) as Partial<StoredGoogleDriveToken>;
    if (
      typeof stored.accessToken !== 'string'
      || !stored.accessToken
      || typeof stored.expiresAt !== 'number'
      || stored.expiresAt <= Date.now()
    ) {
      localStorage.removeItem(tokenKey(userId));
      return null;
    }
    return stored.accessToken;
  } catch {
    localStorage.removeItem(tokenKey(userId));
    return null;
  }
};

export const clearGoogleDriveAccessToken = (userId: string) => {
  if (userId) localStorage.removeItem(tokenKey(userId));
};

export const markGoogleDriveConnectionRequested = () => {
  sessionStorage.setItem(CONNECTION_INTENT_KEY, String(Date.now()));
};

export const hasGoogleDriveConnectionRequest = () => {
  const requestedAt = Number(sessionStorage.getItem(CONNECTION_INTENT_KEY));
  return Number.isFinite(requestedAt)
    && requestedAt > 0
    && Date.now() - requestedAt <= CONNECTION_INTENT_LIFETIME_MS;
};

export const clearGoogleDriveConnectionRequest = () => {
  sessionStorage.removeItem(CONNECTION_INTENT_KEY);
};
