-- Allow a service fulfilment draft to carry one optional Telegram attachment.
-- Existing drafts and order/payment history are preserved unchanged.
ALTER TABLE service_delivery_drafts
  ADD COLUMN media_kind TEXT CHECK(media_kind IS NULL OR media_kind IN ('photo','document'));
ALTER TABLE service_delivery_drafts
  ADD COLUMN media_file_id TEXT;
ALTER TABLE service_delivery_drafts
  ADD COLUMN media_mime_type TEXT;
