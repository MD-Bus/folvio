-- 0.2.0: options of a collection.
-- show_files = 1: recipients see (and preview or download) every file in the folders they can open, not only theirs.
ALTER TABLE collections ADD COLUMN show_files INTEGER NOT NULL DEFAULT 0;
-- auto_delete = 1: the collection and everything in it is deleted by the hourly clean-up once `expires` has passed.
ALTER TABLE collections ADD COLUMN auto_delete INTEGER NOT NULL DEFAULT 0;
CREATE INDEX collection_expiry ON collections(auto_delete, expires);
