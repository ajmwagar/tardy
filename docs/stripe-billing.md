# Stripe billing runbook

Tardy owns checkout and billing management on `tardy.news`; iOS only opens a short-lived
handoff URL and displays the resulting entitlement. REAL Tardy is a recurring $20/month
Price. SUPER Tardy is a $250 one-time Price with PostgreSQL reservations enforcing the
global 1,000-slot limit.

## Local development

1. Copy `.env.example` to ignored `.env.local`.
2. Put a Stripe sandbox secret key in `STRIPE_SECRET_KEY`.
3. Run `stripe listen --forward-to http://127.0.0.1:3300/v1/web/billing/stripe/webhook`
   and put its temporary `whsec_...` value in `STRIPE_WEBHOOK_SECRET`.
4. Export the file into the process environment before starting Tardy:

   ```sh
   set -a
   source .env.local
   set +a
   cargo run --bin tardy
   ```

The committed sandbox Price IDs belong to the Future Present Labs Stripe sandbox:

- REAL Tardy: `price_1UM06o6805BvilhV8dvcLRAP`
- SUPER Tardy: `price_1UM06q6805BvilhV3xBBAFXV`

Use Stripe's standard sandbox card `4242 4242 4242 4242` with any future expiry and CVC.

## Production

Complete Stripe account onboarding first; `acct_1ULPCq6805BvilhV` currently reports
`charges_enabled: false`. Create equivalent live-mode Prices and pass their public
`price_...` IDs through the two OpenTofu variables. Configure a live webhook endpoint:

`https://api.tardy.news/v1/web/billing/stripe/webhook`

Subscribe it to:

- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Store the live secret key and webhook signing secret in the operator-owned Stripe secret
binding. OpenTofu receives only `binding://<project>/secrets/stripe`; it must never receive
the actual values. `tardy-t3rz` tracks the missing customer-managed secret-binding resource
in `fpl-opentofu`.

## Manual verification

1. Open verification from a signed-in app. The five-minute handoff may be exchanged once.
2. Complete sandbox Checkout.
3. Confirm the webhook returns 204 and the profile shows REAL or SUPER Tardy.
4. Replay the same Stripe event; it must remain a no-op.
5. For REAL Tardy, open **Manage Stripe billing**, cancel, and confirm the deletion webhook
   revokes the entitlement.
