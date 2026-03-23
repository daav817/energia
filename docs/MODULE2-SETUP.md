# Module 2: Communication Hub - Gmail Setup

## Google Cloud Console Setup

1. **Create a project** at [Google Cloud Console](https://console.cloud.google.com/)
2. **Enable Gmail API**: APIs & Services → Library → search "Gmail API" → Enable
3. **Configure OAuth consent screen**:
   - APIs & Services → OAuth consent screen
   - User type: External (or Internal for workspace)
   - Add scopes: `gmail.send`, `gmail.readonly`, `gmail.modify`, `userinfo.email`
4. **Create OAuth credentials**:
   - APIs & Services → Credentials → Create Credentials → OAuth client ID
   - Application type: **Web application**
   - Authorized redirect URIs: `http://localhost:3001/api/gmail/callback`
   - (For production, add your deployed URL)
5. **Copy Client ID and Client Secret** to your `.env`:
   ```
   GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
   GOOGLE_CLIENT_SECRET="your-client-secret"
   GOOGLE_REDIRECT_URI="http://localhost:3001/api/auth/google/callback"
   NEXT_PUBLIC_APP_URL="http://localhost:3001"
   ```

## Connect Gmail

1. Start the app: `docker compose up -d` (or `npm run dev`)
2. Go to **Communications** → **Connect Gmail**
3. Authorize with your energy brokerage Gmail account
4. Tokens are stored in `data/gmail-tokens.json` (gitignored)

## Usage

- **Inbox**: View recent emails from Gmail
- **Sync to DB**: Saves emails to database and links to customers/suppliers by matching email addresses
- **Compose**: Send emails to customers/suppliers
- **RFP Generator**: Select customer, energy type → send RFP to all matching suppliers
- **Quotes**: Add supplier quotes, mark best offer, compare pricing
