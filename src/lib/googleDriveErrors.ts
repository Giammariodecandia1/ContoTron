// Only a missing/revoked Google grant can be repaired by asking for consent.
// Service, app-session and file-permission errors must retain their real cause.
export class GoogleDriveAuthError extends Error {
  constructor(message = 'Google Drive non collegato o autorizzazione scaduta.') {
    super(message);
    this.name = 'GoogleDriveAuthError';
  }
}

export class GoogleDriveServiceError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'GoogleDriveServiceError';
    this.status = status;
  }
}

export const googleDriveServerError = async (error: unknown): Promise<Error> => {
  const context = error && typeof error === 'object' && 'context' in error
    ? (error as { context?: unknown }).context
    : null;
  let detail = error instanceof Error ? error.message : 'Servizio non disponibile.';
  let code = '';
  const status = context instanceof Response ? context.status : undefined;
  if (context instanceof Response) {
    try {
      const payload = await context.clone().json() as { error?: string; message?: string; code?: string };
      detail = payload.error || payload.message || detail;
      code = payload.code || '';
    } catch { /* Keep the HTTP status for non-JSON gateway responses. */ }
  }
  if (['drive_not_connected', 'google_grant_revoked', 'drive_scope_missing'].includes(code)
    || detail === 'Google Drive deve essere collegato.'
    || detail === 'Token has been expired or revoked.') {
    return new GoogleDriveAuthError('Il consenso Google Drive manca o è stato revocato. Ricollega Google Drive.');
  }
  if (status === 401) {
    return new GoogleDriveServiceError('Il servizio Drive non riesce a verificare la sessione Contotron. Il consenso Google non è necessariamente scaduto.', status);
  }
  if (status === 404) {
    return new GoogleDriveServiceError('Il servizio di rinnovo Google Drive non è disponibile sul server.', status);
  }
  return new GoogleDriveServiceError(`Rinnovo Google Drive non disponibile: ${detail}`, status);
};
