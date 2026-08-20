import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders });
const requiredEnv = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Configurazione server mancante: ${name}`);
  return value;
};

const encryptionKey = async () => {
  const raw = Uint8Array.from(atob(requiredEnv('GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY')), character => character.charCodeAt(0));
  if (raw.length !== 32) throw new Error('GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY deve contenere 32 byte in Base64.');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
};

const encrypt = async (value: string) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(), new TextEncoder().encode(value)));
  const combined = new Uint8Array(iv.length + encrypted.length);
  combined.set(iv);
  combined.set(encrypted, iv.length);
  return btoa(String.fromCharCode(...combined));
};

const decrypt = async (ciphertext: string) => {
  const combined = Uint8Array.from(atob(ciphertext), character => character.charCodeAt(0));
  if (combined.length <= 12) throw new Error('Credenziale Google Drive non valida.');
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: combined.slice(0, 12) }, await encryptionKey(), combined.slice(12));
  return new TextDecoder().decode(plaintext);
};

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Metodo non supportato.' }, 405);
  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization) return json({ error: 'Sessione Contotron mancante.' }, 401);
    const supabaseUrl = requiredEnv('SUPABASE_URL');
    const userClient = createClient(supabaseUrl, requiredEnv('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: 'Sessione Contotron non valida.' }, 401);
    const body = await request.json() as { action?: string; refreshToken?: string };
    const admin = createClient(supabaseUrl, requiredEnv('SUPABASE_SERVICE_ROLE_KEY'));

    if (body.action === 'store_refresh_token') {
      if (!body.refreshToken?.trim()) return json({ error: 'Refresh token Google mancante.' }, 400);
      const { error } = await admin.from('google_drive_oauth_credentials').upsert({
        user_id: user.id,
        refresh_token_ciphertext: await encrypt(body.refreshToken.trim()),
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      return json({ stored: true });
    }

    if (body.action === 'get_access_token') {
      const { data: credential, error } = await admin.from('google_drive_oauth_credentials')
        .select('refresh_token_ciphertext').eq('user_id', user.id).maybeSingle();
      if (error) throw error;
      if (!credential) return json({ error: 'Google Drive deve essere collegato.' }, 404);
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: requiredEnv('GOOGLE_OAUTH_CLIENT_ID'),
          client_secret: requiredEnv('GOOGLE_OAUTH_CLIENT_SECRET'),
          grant_type: 'refresh_token',
          refresh_token: await decrypt(credential.refresh_token_ciphertext),
        }),
      });
      const tokenPayload = await tokenResponse.json() as { access_token?: string; expires_in?: number; error_description?: string };
      if (!tokenResponse.ok || !tokenPayload.access_token) return json({ error: tokenPayload.error_description || 'Autorizzazione Google Drive non piu valida.' }, 401);
      return json({ accessToken: tokenPayload.access_token, expiresIn: tokenPayload.expires_in || 3600 });
    }
    return json({ error: 'Azione non valida.' }, 400);
  } catch (error) {
    console.error('google-drive-token', error);
    return json({ error: error instanceof Error ? error.message : 'Errore server Google Drive.' }, 500);
  }
});
