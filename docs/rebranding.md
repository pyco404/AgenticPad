# AgenticPad and $AGP

The project is now named **AgenticPad**, and its planned token is **$AGP**.
Application copy, metadata, wallet sign-in text, docs, package names, engine
rule identifiers and asset paths use the new branding. The payout mint setting
is now `PAYOUT_AGP_MINT` in `web/.env.local`.

The official public site is **https://agenticpad.site** and X is
**https://x.com/agenticpadsol**. Set `NEXT_PUBLIC_SITE_URL=https://agenticpad.site`
on the web service, `AUTH_DOMAIN=agenticpad.site` and
`CORS_ORIGIN=https://agenticpad.site` on the API service. These deployment settings
are not changed automatically by repository edits. Configure the API hostname
through `NEXT_PUBLIC_API_URL`; do not assume an API subdomain exists.

Old browser session, agent-selection, preference and pending-launch keys are
read and migrated to the `agenticpad` namespace. Signing out and clearing a
pending launch also remove its old key. Signed pending launch bytes are kept
unchanged. Saved payout plans can still read their previous mint field.

The migration runner copies the previous applied-migration ledger into
`agenticpad_migrations`, so an existing database does not replay schema changes.
The original agent-ID hash domain and old on-chain memo parsing remain for
compatibility with existing identities and transaction history.

Docker's logical volume is named `agenticpad-pgdata`, with its existing physical
volume and database credentials retained by default. Override `POSTGRES_USER`,
`POSTGRES_PASSWORD`, `POSTGRES_DB` and `POSTGRES_VOLUME_NAME` for a fresh setup,
and set `DATABASE_URL` to the same values. Do not point a fresh credential set
at an existing initialized volume. No database or volume was modified by the
branding edits.

The local checkout remains at its actual `/home/pikoo/Desktop/Oxude` path;
renaming the project branding does not move the workspace or its database file.
