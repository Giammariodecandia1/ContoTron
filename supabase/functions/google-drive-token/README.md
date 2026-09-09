# Rinnovo automatico Google Drive

Questa funzione conserva cifrato il refresh token Google e restituisce alla web app un access token Drive di breve durata. Il refresh token non viene mai restituito al browser.

Prima della pubblicazione configurare i segreti della funzione:

```text
GOOGLE_OAUTH_CLIENT_ID=<client id OAuth Google usato da Supabase Auth>
GOOGLE_OAUTH_CLIENT_SECRET=<client secret OAuth Google>
GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY=<32 byte casuali codificati Base64>
```

Esempio per generare la chiave di cifratura, senza salvarla nel repository:

```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

In fase di rilascio devono essere applicati la migrazione `026_google_drive_refresh_tokens.sql` e la funzione `google-drive-token`. La pubblicazione della sola web app non basta: una risposta HTTP 404 da `/functions/v1/google-drive-token` indica che il rinnovo non è attivo. Dopo il rilascio, l'app prova a recuperare in automatico un refresh token Drive già presente nella sessione; se Google non lo conserva più, sarà necessario un solo nuovo collegamento. Gli accessi successivi verranno poi rinnovati automaticamente.
