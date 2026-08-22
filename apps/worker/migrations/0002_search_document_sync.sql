INSERT INTO search_documents_fts (
  rowid, title, content, tags, properties, attachment_names, ocr_text
)
SELECT rowid, title, content, tags, properties, attachment_names, ocr_text
FROM search_documents;

CREATE TRIGGER search_documents_ai AFTER INSERT ON search_documents BEGIN
  INSERT INTO search_documents_fts (
    rowid, title, content, tags, properties, attachment_names, ocr_text
  ) VALUES (
    new.rowid, new.title, new.content, new.tags, new.properties, new.attachment_names, new.ocr_text
  );
END;

CREATE TRIGGER search_documents_ad AFTER DELETE ON search_documents BEGIN
  INSERT INTO search_documents_fts (
    search_documents_fts, rowid, title, content, tags, properties, attachment_names, ocr_text
  ) VALUES (
    'delete', old.rowid, old.title, old.content, old.tags, old.properties, old.attachment_names, old.ocr_text
  );
END;

CREATE TRIGGER search_documents_au AFTER UPDATE ON search_documents BEGIN
  INSERT INTO search_documents_fts (
    search_documents_fts, rowid, title, content, tags, properties, attachment_names, ocr_text
  ) VALUES (
    'delete', old.rowid, old.title, old.content, old.tags, old.properties, old.attachment_names, old.ocr_text
  );
  INSERT INTO search_documents_fts (
    rowid, title, content, tags, properties, attachment_names, ocr_text
  ) VALUES (
    new.rowid, new.title, new.content, new.tags, new.properties, new.attachment_names, new.ocr_text
  );
END;
