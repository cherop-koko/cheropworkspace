# Separate Imweb sales verification screen

`sales-verification.html` is independent of `index.html` and the legacy sales modules. Existing manual data stays in its existing tables. API orders use the already-created `commerce_*` tables. This change does not switch the main screen or combine source totals.

## Credentials and access

Use the issued Imweb REST API V2 Key and Secret. An owner/admin enters them into the Supabase project's Edge Functions → Secrets as `IMWEB_API_KEY` and `IMWEB_SECRET_KEY`. Never place values in chat, GitHub, browser configuration, URLs, logs, or this document. The server exchanges these credentials for an access token and requests orders with that token.

Provision the representative and authorized co-manager as real Supabase Auth accounts and map verified user IDs to `commerce_access` before use. Do not authorize users from display names, the old PIN login, editable metadata, or self-registration. Existing legacy RLS issues are separate and remain unresolved by this page.

After signing in, use **연결 확인** to exchange the server-held credentials for an Imweb token. The endpoint requires an enabled administrator and returns only success and a check timestamp. It does not return keys/tokens, fetch orders, or write database rows. A successful token exchange does not verify order/refund mapping.

## Server preparation

The source in `supabase/functions/commerce-api` starts from recovered deployed v1. New endpoints add authenticated manual page advancement and admin-only read access to legacy 자사몰 totals. No new SQL migration is included here. `tick` and requests to enable scheduled collection are denied. Keep the existing cron job inactive.

The public frontend config includes only the existing public anon key. The page uses a separate sessionStorage key and does not import any legacy application script. The server revalidates every user's Auth token and `commerce_access` record.

## Verification before cutover

1. Save a fresh private backup and verify current record counts and relationships before any production mutation.
2. Confirm anonymous calls fail and only the approved administrator accounts can read or synchronize.
3. Set the collection start date. Collect in batches; the manual advance endpoint continues queued work without enabling cron. The page pauses after four advances; another click resumes queued work. An in-flight server batch can finish after closing the page.
4. Compare live paid orders, duplicate requests, cancellations, partial refunds and refund dates with the seller center. Compare manual and API totals separately, using documented matching dates and definitions.
5. Verify legacy records, amounts and relationships remain unchanged, apart from identifiable legitimate staff edits during the check.
6. Only after these checks and a separately reviewed cutover change, move to the new view. This page deliberately has no working cutover control.

## Current limits

No live API credentials were used to develop this change. No live order import, refund reconciliation, account provisioning, database migration, server deployment or screen cutover is implied by unit tests. The V2 adapter's amount/status mappings must be verified against real responses. Refund amount/date and net sales remain unverified. Missing collection stays unknown rather than zero. A matching displayed difference is not proof of matching accounting definitions.

Net sales is intended as verified payments minus verified refunds, with payment-date and refund-date period attribution made explicit. Fees/settlement, Meta attribution, Toss item records, Kakao and The Hyundai Hi are excluded from the API total.

## Checks

Run `node --test tests/commerce/server.test.mjs tests/commerce/ui.test.cjs` with Node 24 or later. These use synthetic data and mocked HTTP, not the production database.
