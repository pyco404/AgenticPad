# AgenticPad and $AGP

The project is now named **AgenticPad**, and its planned token is **$AGP**.
Application copy, metadata, wallet sign-in text, docs, package names, engine
rule identifiers and asset paths use the new branding. The payout mint setting
is now `PAYOUT_AGP_MINT` in `web/.env.local`.

Configure the deployment's real public addresses with `NEXT_PUBLIC_SITE_URL`,
`NEXT_PUBLIC_SOCIAL_X_URL` and `NEXT_PUBLIC_REPOSITORY_URL`. The current live
website, social account and GitHub links are retained until new addresses are
provided; changing a display name does not register domains or rename accounts.
Set the backend's `AUTH_DOMAIN` and `CORS_ORIGIN` to match a new deployed domain.

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
