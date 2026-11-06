# Smart-Wifi

# ELVIS Wi-Fi Hotspot

Customer portal starter project for selling time-based Wi-Fi access using M-Pesa STK Push and MikroTik RouterOS 7 REST API.

## Important

- This is an integration starter, not a ready-to-run public Wi-Fi service.
- Start with Daraja sandbox credentials.
- Real automatic activation requires a MikroTik RouterOS hotspot configured in the network path.
- Your ISP must permit reselling/redistribution.
- The server must be deployed on a public HTTPS domain so Safaricom can reach the callback URL.
- Never put Daraja or MikroTik secrets in frontend JavaScript or commit `.env`.

## Requirements

- Node.js 20 or newer
- MikroTik RouterOS 7 with Hotspot configured
- Daraja developer account and sandbox app
- Public HTTPS hosting for the Node server and callback

## Install

```bash
npm install
cp .env.example .env
```

Fill `.env` with Daraja sandbox credentials and MikroTik REST credentials.

Run locally:

```bash
npm run dev
```

Open `http://localhost:3000`.

## M-Pesa callback

The callback must be reachable over public HTTPS. Set `MPESA_CALLBACK_URL` to:

`https://YOUR-DOMAIN/api/mpesa/callback/YOUR_CALLBACK_SECRET`

The secret segment must match `MPESA_CALLBACK_SECRET`.

## MikroTik setup overview

1. Put the MikroTik between the ISP router and the customer access point(s).
2. Configure a Hotspot server on the customer-facing interface/bridge.
3. Configure the Hotspot login page to redirect to your public portal. Start from `hotspot/login.html` and replace the domain.
4. Set up RouterOS REST API over HTTPS with a restricted user. Limit `www-ssl` access to your backend server IP/VPN.
5. Set `MIKROTIK_BASE_URL`, username, password and hotspot profile in `.env`.
6. Set `HOTSPOT_LOGIN_ORIGIN` to the exact origin used in the MikroTik `link-login-only` URL.

The server creates a unique Hotspot user after a successful Daraja callback and removes it when the purchased wall-clock duration expires. RouterOS user `limit-uptime` is also set as a secondary usage cap.

## Router security

Use RouterOS HTTPS REST (`www-ssl`) with a valid certificate. Do not expose router management or REST to the public internet. Restrict the REST service to the backend's private/VPN IP, use a dedicated least-privilege account, and keep the router password only on the server.

The current sample uses RouterOS REST calls to add and remove Hotspot users. Test with a spare router and a test device before allowing paying customers.

## Before going live

- Verify payment callback behavior and reconcile payments with Daraja transaction status.
- Add admin authentication, audit logs, backups, and customer support details.
- Add idempotent payment processing and a retry queue for router outages.
- Test duplicate callbacks, failed payments, customer reconnects, expiry, and power/network failures.
- Configure TLS and production Daraja credentials only after Safaricom approval.


## Admin dashboard

Open `/admin` and sign in using `ADMIN_USERNAME` and `ADMIN_PASSWORD` from `.env`. Change the default password before deployment. The sample uses HTTP Basic authentication; always serve the application over HTTPS. Add stronger account management and multi-factor authentication before operating at scale.
