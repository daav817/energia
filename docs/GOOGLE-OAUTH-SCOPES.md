# Google OAuth Scopes for Energia App

## Required Scopes (already configured)

These scopes are requested when you connect Gmail:

| Scope | Purpose |
|-------|---------|
| `gmail.send` | Send emails |
| `gmail.readonly` | Read emails and labels |
| `gmail.modify` | Modify emails (archive, trash, mark read, add/remove labels) |
| `gmail.labels` | Full access to manage labels |
| `userinfo.email` | Get your email address |

## Google Cloud Console Setup

1. **OAuth consent screen** → Scopes → Add or remove scopes
2. Add these scopes (if not already present):
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/gmail.labels`
   - `https://www.googleapis.com/auth/userinfo.email`

3. **Credentials** → Your OAuth 2.0 Client ID → Authorized redirect URIs:
   - `http://localhost:3001/api/gmail/callback`
   - (For production: add your deployed URL)

## Re-authorize after adding scopes

If you add new scopes, you must reconnect Gmail:

1. Delete `data/gmail-tokens.json` (or the tokens file)
2. Go to Communications → Connect Gmail
3. Authorize again with the new scopes
