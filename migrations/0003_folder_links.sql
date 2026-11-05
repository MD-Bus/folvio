CREATE TABLE folder_links (
 token TEXT PRIMARY KEY,
 collection TEXT NOT NULL REFERENCES collections(id),
 folder TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
 created INTEGER NOT NULL
);
CREATE INDEX folder_links_collection ON folder_links(collection,folder);
