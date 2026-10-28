-- Remove Telegram media pointers from records whose media has already been delivered,
-- forwarded, cancelled, or expired. D1 stores Telegram file references, not media bytes.
UPDATE payment_receipt_submissions
SET telegram_file_id='', telegram_file_unique_id=NULL, mime_type=NULL, file_size=NULL
WHERE status='forwarded';

UPDATE delivery_drafts
SET media_kind=NULL, media_file_id=NULL, media_mime_type=NULL
WHERE status IN ('sent','cancelled','expired');

UPDATE service_delivery_drafts
SET media_kind=NULL, media_file_id=NULL, media_mime_type=NULL
WHERE status IN ('sent','cancelled','expired');

UPDATE admin_message_drafts
SET media_kind=NULL, media_file_id=NULL, media_mime_type=NULL
WHERE status IN ('sent','cancelled','expired');

UPDATE admin_broadcast_drafts
SET media_kind=NULL, media_file_id=NULL, media_mime_type=NULL
WHERE status IN ('sent','partial','cancelled','expired');
