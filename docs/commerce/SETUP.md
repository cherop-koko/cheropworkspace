# Separate Imweb sales verification screen

`sales-verification.html` is independent of `index.html` and the legacy sales modules. Existing manual data stays in its existing tables. API orders use the already-created `commerce_*` tables. This change does not switch the main screen or combine source totals.

## Credentials and access

Use the issued Imweb REST API V2 Key and Secret. An owner/admin enters them into the Supabase project's Edge Functions → Secrets as `IMWEB_API_KEY` and `IMWEB_SECRET_KEY`. Never place values in chat, GitHub, browser configuration, URLs, logs, or this document. The server exchanges these credentials for an access token and requests orders with that token.

Use the **existing workspace name selector** for both pages. `workspace-auth` validates passwords through Supabase Auth. The browser shares one persistent session; there is no second email/password form or separate sales account. Existing member IDs and business records remain unchanged.

The previously public six-digit PINs are compromised credentials and must not be migrated into server authority. The project owner enters a **new, unique password for each existing member**, once, in [Edge Function Secrets](https://supabase.com/dashboard/project/pmgntojnfglppjtypwzq/settings/functions). Do not send these passwords through chat. Each must have 12–128 characters including letters and non-letters; use a password manager to generate them.

| Existing member | Secret name |
| --- | --- |
| 고예흰 | `WORKSPACE_PASSWORD_CEO` |
| 김효민 | `WORKSPACE_PASSWORD_HYOMIN` |
| 정현진 | `WORKSPACE_PASSWORD_HYUNJIN` |
| 김성애 | `WORKSPACE_PASSWORD_SUNGAE` |

On a member's first successful login with this owner-set password, the server creates the corresponding Auth identity and fixed trusted metadata. No separate email account, invitation, or user signup is required. Internal `@workspace.cherop.invalid` identifiers are non-deliverable Auth aliases, not employee email addresses. The server never resets an existing account or attaches permissions to a colliding account. Do not delete/re-create Auth users to reset passwords: an owner should update that user's password through Supabase Auth administration. Remove each bootstrap secret after that member's Auth identity is provisioned. The secrets do not reset existing passwords if changed later.

Permissions derive only from server-managed `app_metadata.workspace_member_id` and `workspace_enabled`. Only `ceo` and `hyomin` may use the commerce API, including reads. Set `workspace_enabled=false` through Auth administration to disable this binding; the API fetches current Auth user metadata each time. Existing enabled `commerce_access` administrators remain compatible for non-workspace identities; workspace identities cannot bypass disabled metadata through that fallback. Editable user metadata and `cherop_uid` never authorize. Existing legacy table RLS issues are separate and remain unresolved by this login change.

After signing in, use **연결 확인** to exchange the server-held credentials for an Imweb token. The endpoint requires an enabled administrator and returns only success and a check timestamp. It does not return keys/tokens, fetch orders, or write database rows. A successful token exchange does not verify order/refund mapping.

## Server preparation

The source in `supabase/functions/commerce-api` starts from recovered deployed v1. New endpoints add authenticated manual page advancement and admin-only read access to legacy 자사몰 totals. No new SQL migration is included here. `tick` and requests to enable scheduled collection are denied. Keep the existing cron job inactive.

The public frontend config includes only the existing public anon key. Both pages use `workspace-auth-client.js`, the same Supabase client configuration and `cherop-workspace-auth-v1` localStorage session. Verification does not import legacy business modules. Logout broadcasts across tabs in the same browser. Commerce endpoints revalidate Auth and server-managed access, rather than trusting client state.

Deploy `workspace-auth` and the updated `commerce-api` with their `_shared/workspace-identity.mjs` dependency. Their gateway `verify_jwt` is false because the login endpoint authenticates a password and authenticated endpoints independently call Auth `/user`. No business table migration or legacy data write is part of this change.

Before publishing the new main login, configure all four new passwords, privately distribute each to the relevant member, and verify real login/session restore using the configured accounts. Do not deploy a login that locks staff out. The old main page remains in service until the coordinated rollout. Keep the current main commit as a rollback reference, but understand that reverting restores the old insecure PIN UI and is not a security fix.

## Verification before cutover

1. Save a fresh private backup and verify current record counts and relationships before any production mutation.
2. Confirm anonymous calls fail and only the approved administrator accounts can read or synchronize.
3. Set the collection start date. Collect in batches; the manual advance endpoint continues queued work without enabling cron. The page pauses after four advances; another click resumes queued work. An in-flight server batch can finish after closing the page.
4. Compare live paid orders, duplicate requests, cancellations, partial refunds and refund dates with the seller center. Compare manual and API totals separately, using documented matching dates and definitions.
5. Verify legacy records, amounts and relationships remain unchanged, apart from identifiable legitimate staff edits during the check.
6. Only after these checks and a separately reviewed cutover change, move to the new view. This page deliberately has no working cutover control.

## Current limits

Automated tests use synthetic credentials. Actual password setup, successful live employee login and Imweb token/order verification are separate rollout checks. No live order import, refund reconciliation, account provisioning, database migration, server deployment or screen cutover is implied by unit tests. The V2 adapter's amount/status mappings must be verified against real responses. Refund amount/date and net sales remain unverified. Missing collection stays unknown rather than zero. A matching displayed difference is not proof of matching accounting definitions.

Net sales is intended as verified payments minus verified refunds, with payment-date and refund-date period attribution made explicit. Fees/settlement, Meta attribution, Toss item records, Kakao and The Hyundai Hi are excluded from the API total.

## Checks

Run `node --test tests/commerce/*.test.*` with Node 24 or later. These use synthetic data and mocked HTTP, not the production database.
