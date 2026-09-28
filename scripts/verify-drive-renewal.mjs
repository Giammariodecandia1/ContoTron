import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const moduleUrl = async (path, replacements = []) => {
  let output = ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [from, to] of replacements) output = output.replaceAll(from, to);
  return `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`;
};

const errorsUrl = await moduleUrl('../src/lib/googleDriveErrors.ts');
const { GoogleDriveAuthError, GoogleDriveServiceError, googleDriveServerError } = await import(errorsUrl);
const httpError = (status, body) => Object.assign(new Error('Edge request failed'), {
  context: new Response(JSON.stringify(body), { status }),
});
assert.ok(await googleDriveServerError(httpError(404, { error: 'Google Drive deve essere collegato.' })) instanceof GoogleDriveAuthError);
assert.ok(await googleDriveServerError(httpError(404, { message: 'Function not found' })) instanceof GoogleDriveServiceError);
assert.ok(await googleDriveServerError(httpError(401, { message: 'Invalid JWT' })) instanceof GoogleDriveServiceError);
assert.ok(await googleDriveServerError(httpError(500, { error: 'Configurazione server mancante' })) instanceof GoogleDriveServiceError);

// Test the real renewal implementation with a controlled Supabase transport.
const stubUrl = 'data:text/javascript;base64,' + Buffer.from(`
export const calls = [];
export const replies = [];
export const session = { user: { id: 'user-a' }, access_token: 'jwt-current', expires_at: Date.now()/1000+3600 };
export const supabase = {
  auth: {
    getSession: async () => ({data: {session}}),
    refreshSession: async () => {
      calls.push('refresh-session'); session.access_token = 'jwt-refreshed';
      return {data: {session}, error: null};
    },
  },
  functions: {invoke: async (name, options) => { calls.push(options); return replies.shift(); }},
};
`).toString('base64');
const stub = await import(stubUrl);
const serverUrl = await moduleUrl('../src/lib/googleDriveServerToken.ts', [
  ["'./supabaseClient'", `'${stubUrl}'`],
  ["'./googleDriveErrors'", `'${errorsUrl}'`],
]);
const { getGoogleDriveServerAccessToken, clearGoogleDriveServerAccessTokenCache } = await import(serverUrl);
stub.replies.push({ data: { accessToken: 'google-first', expiresIn: 3600 }, error: null });
assert.equal(await getGoogleDriveServerAccessToken(), 'google-first');
assert.equal(stub.calls[0].headers.Authorization, 'Bearer jwt-current');
// Advance the clock beyond the one-hour lifetime; no logout or Google consent.
const realNow = Date.now;
Date.now = () => realNow() + 61 * 60 * 1000;
stub.session.expires_at = Date.now()/1000 + 3600;
stub.replies.push({ data: { accessToken: 'google-renewed', expiresIn: 3600 }, error: null });
assert.equal(await getGoogleDriveServerAccessToken(), 'google-renewed');
assert.equal(await getGoogleDriveServerAccessToken(), 'google-renewed');
assert.equal(stub.calls.length, 2, 'Unexpired tokens should be reused');
Date.now = realNow;

clearGoogleDriveServerAccessTokenCache();
stub.replies.push({ error: httpError(401, { message: 'Invalid JWT' }) }, { data: { accessToken: 'after-session-refresh' } });
assert.equal(await getGoogleDriveServerAccessToken(), 'after-session-refresh');
assert.equal(stub.calls.at(-1).headers.Authorization, 'Bearer jwt-refreshed');

clearGoogleDriveServerAccessTokenCache();
const beforeFailure = stub.calls.length;
stub.replies.push({ error: httpError(500, { error: 'Server misconfigured' }) });
await assert.rejects(getGoogleDriveServerAccessToken(), GoogleDriveServiceError);
assert.equal(stub.calls.length, beforeFailure + 1, 'Server faults must not cause app-session refresh loops');

// A failed callback deposit can be recovered using the existing OAuth session.
stub.session.provider_refresh_token = 'test-google-refresh';
stub.replies.push(
  { error: httpError(404, { error: 'Google Drive deve essere collegato.' }) },
  { data: { stored: true } },
  { data: { accessToken: 'recovered' } },
);
assert.equal(await getGoogleDriveServerAccessToken(), 'recovered');
assert.equal(stub.calls.at(-2).body.action, 'store_refresh_token');

// A different Contotron user must never receive the previous user's cached token.
stub.session.user.id = 'user-b';
stub.replies.push({ data: { accessToken: 'user-b-google' } });
assert.equal(await getGoogleDriveServerAccessToken(), 'user-b-google');
assert.equal(stub.replies.length, 0);
console.log('Drive renewal: server errors, JWT retry, recovery, cache and user isolation OK');
