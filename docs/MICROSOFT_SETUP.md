# Microsoft account setup

Each developer or distributor supplies their own Microsoft Entra public-client app
registration. No registration identifiers from the original developer are included.

1. In the Microsoft Entra admin center, open **App registrations → New registration**.
2. Choose an account audience appropriate for your users. For your own organization,
   use single tenant. For other organizations or personal Microsoft accounts, choose
   the corresponding audience supported by your registration.
3. Under **Authentication → Advanced settings**, enable **Allow public client flows**
   for device-code sign-in. This flow does not require a client secret or a redirect URI.
4. Add Microsoft Graph **delegated** permission `Mail.Read`. Grant consent according
   to your organization's policy. The application does not use application permissions.
   MSAL manages the OpenID/offline scopes needed for authentication and token renewal.
5. Copy the **Application (client) ID** into `AZURE_CLIENT_ID`, and the **Directory
   (tenant) ID** into `AZURE_TENANT_ID` in your ignored `.env` file.
6. Restart the app and connect. Enter the device code only on Microsoft's verification
   site. Do not share that code, tokens, or screenshots of your account information.

For a multi-tenant registration, the tenant setting can be `organizations`,
`consumers`, or `common`, matching the audience you registered. A single-tenant
registration requires its actual tenant UUID. A supported audience does not guarantee
that an organization's policies permit device-code sign-in or delegated mail access.

## Packaged configuration

Create `config.json` inside the Electron user-data directory (normally
`~/Library/Application Support/newsletter-unsubscriber-mac/` on macOS):

```json
{
  "clientId": "00000000-0000-0000-0000-000000000000",
  "tenantId": "organizations"
}
```

Replace the placeholder client ID. Environment variables take precedence over this
file. The packaged application does not read a working-directory `.env` file.
Do not place tokens, passwords, or client secrets in this configuration.

Official references:

- [Desktop app configuration](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-app-configuration)
- [Device authorization flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code)
- [Microsoft Graph permissions](https://learn.microsoft.com/en-us/graph/permissions-reference#mailread)
