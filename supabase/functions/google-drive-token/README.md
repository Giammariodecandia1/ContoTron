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

In fase di rilascio devono essere applicati la migrazione `026_google_drive_refresh_tokens.sql` e la funzione `google-drive-token`. Dopo il primo nuovo collegamento Google Drive, l'app salverà il refresh token cifrato e gli accessi successivi verranno rinnovati automaticamente.
