// Only Admin API app_metadata can bind an Auth identity to an existing employee.
// Never derive permissions from user_metadata, browser storage or display names.
export const members = Object.freeze({
  ceo: { id: 'ceo', name: '고예흰', admin: true },
  hyomin: { id: 'hyomin', name: '김효민', admin: true },
  hyunjin: { id: 'hyunjin', name: '정현진', admin: false },
  sungae: { id: 'sungae', name: '김성애', admin: false }
});
export function workspaceProfile(identity) {
  const metadata = identity?.app_metadata;
  if (!identity?.id || !identity.email_confirmed_at || identity.is_anonymous || metadata?.workspace_enabled !== true) return null;
  const member = Object.hasOwn(members, metadata.workspace_member_id) ? members[metadata.workspace_member_id] : null;
  return member ? { ...member } : null;
}
