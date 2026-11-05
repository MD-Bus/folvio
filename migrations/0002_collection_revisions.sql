ALTER TABLE collections ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
CREATE TRIGGER collection_revision AFTER UPDATE ON collections
WHEN NEW.revision = OLD.revision BEGIN
 UPDATE collections SET revision=revision+1 WHERE id=NEW.id;
END;
CREATE TRIGGER folder_insert_revision AFTER INSERT ON folders BEGIN
 UPDATE collections SET revision=revision+1 WHERE id=NEW.collection;
END;
CREATE TRIGGER folder_update_revision AFTER UPDATE ON folders BEGIN
 UPDATE collections SET revision=revision+1 WHERE id=NEW.collection;
END;
CREATE TRIGGER folder_delete_revision AFTER DELETE ON folders BEGIN
 UPDATE collections SET revision=revision+1 WHERE id=OLD.collection;
END;
