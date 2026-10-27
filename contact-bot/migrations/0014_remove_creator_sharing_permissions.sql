-- Remove the retired creator-sharing permission workflow and its stored flags.
-- Preserve existing contact values and contact metadata without modifying request/order history.
CREATE TABLE creator_contacts_new (
  profile_id TEXT PRIMARY KEY,
  contact_value TEXT NOT NULL,
  contact_type TEXT NOT NULL DEFAULT 'telegram',
  updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO creator_contacts_new(profile_id, contact_value, contact_type, updated_at)
SELECT profile_id, contact_value, COALESCE(contact_type, 'telegram'), COALESCE(updated_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
FROM creator_contacts;
DROP TABLE creator_contacts;
ALTER TABLE creator_contacts_new RENAME TO creator_contacts;
