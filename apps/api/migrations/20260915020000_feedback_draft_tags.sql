-- Feedback tags use inbox_item_tags after submission; drafts retain their private input.
ALTER TABLE product_feedback_drafts ADD COLUMN tags text[] NOT NULL DEFAULT '{}';
