const path = require("path");
const { app } = require("electron");
const { DatabaseSync } = require("node:sqlite");

const storageConfigPath = path.join(app.getPath("userData"), "storage.json");
let storageRoot = app.getPath("userData");
try { storageRoot = JSON.parse(require("fs").readFileSync(storageConfigPath, "utf8")).path || storageRoot; } catch {}
const DB_PATH = path.join(storageRoot, "biblioteca.db");

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = DELETE;");
db.exec("PRAGMA foreign_keys = ON;");

function runInTransaction(fn) {
  db.exec("BEGIN");
  try {
    fn();
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// ── Schema ───────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    author TEXT NOT NULL,
    genre TEXT,
    year INTEGER,
    rating REAL DEFAULT 0,
    pages INTEGER DEFAULT 0,
    cover TEXT,
    description TEXT,
    featured INTEGER DEFAULT 0,
    is_read INTEGER DEFAULT 0,
    is_favorite INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS book_tags (
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (book_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS book_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS book_loans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    borrower TEXT NOT NULL,
    lent_at TEXT NOT NULL,
    due_at TEXT,
    returned_at TEXT
  );
`);

// Migração segura para instalações que já têm a biblioteca criada.
const bookColumns = new Set(db.prepare("PRAGMA table_info(books)").all().map((column) => column.name));
for (const [name, definition] of [["format", "TEXT NOT NULL DEFAULT 'Físico'"], ["location", "TEXT NOT NULL DEFAULT ''"], ["borrowed_by", "TEXT NOT NULL DEFAULT ''"], ["notes", "TEXT NOT NULL DEFAULT ''"]]) {
  if (!bookColumns.has(name)) db.exec(`ALTER TABLE books ADD COLUMN ${name} ${definition}`);
}
for (const tag of [{ name: "Laura", color: "#d97148" }, { name: "Silvia", color: "#e8a0a8" }]) {
  if (!db.prepare("SELECT id FROM tags WHERE name = ? COLLATE NOCASE").get(tag.name)) {
    db.prepare("INSERT INTO tags (name, color) VALUES (?, ?)").run(tag.name, tag.color);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function rowToBook(row, tagIdsByBook) {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    genre: row.genre,
    year: row.year,
    rating: row.rating,
    pages: row.pages,
    cover: row.cover,
    description: row.description,
    featured: !!row.featured,
    isRead: !!row.is_read,
    isFavorite: !!row.is_favorite,
    tagIds: tagIdsByBook.get(row.id) || [],
    format: row.format || "Físico",
    location: row.location || "",
    borrowedBy: row.borrowed_by || "",
    notes: row.notes || "",
  };
}

function getAllTagIdsByBook() {
  const rows = db.prepare("SELECT book_id, tag_id FROM book_tags").all();
  const map = new Map();
  rows.forEach((r) => {
    if (!map.has(r.book_id)) map.set(r.book_id, []);
    map.get(r.book_id).push(r.tag_id);
  });
  return map;
}

function getAllNoteContentsByBook() {
  const rows = db.prepare("SELECT book_id, content FROM book_notes ORDER BY created_at DESC, id DESC").all();
  const map = new Map();
  rows.forEach((row) => {
    if (!map.has(row.book_id)) map.set(row.book_id, []);
    map.get(row.book_id).push(row.content);
  });
  return map;
}

// ── API pública do "backend" ─────────────────────────────────────────────

const booksApi = {
  getLoans(bookId) {
    return db.prepare("SELECT id, book_id AS bookId, borrower, lent_at AS lentAt, due_at AS dueAt, returned_at AS returnedAt FROM book_loans WHERE book_id = ? ORDER BY lent_at DESC, id DESC").all(bookId);
  },
  addLoan(bookId, borrower, lentAt, dueAt) {
    if (db.prepare("SELECT id FROM book_loans WHERE book_id = ? AND returned_at IS NULL").get(bookId)) throw new Error("Este livro já possui um empréstimo em aberto.");
    const info = db.prepare("INSERT INTO book_loans (book_id, borrower, lent_at, due_at) VALUES (?, ?, ?, ?)").run(bookId, borrower, lentAt, dueAt);
    db.prepare("UPDATE books SET borrowed_by = ? WHERE id = ?").run(borrower, bookId);
    return this.getLoan(info.lastInsertRowid);
  },
  getLoan(id) {
    return db.prepare("SELECT id, book_id AS bookId, borrower, lent_at AS lentAt, due_at AS dueAt, returned_at AS returnedAt FROM book_loans WHERE id = ?").get(id);
  },
  returnLoan(id) {
    const loan = this.getLoan(id);
    if (!loan) throw new Error("Empréstimo não encontrado.");
    if (!loan.returnedAt) {
      const returnedAt = new Date().toISOString();
      db.prepare("UPDATE book_loans SET returned_at = ? WHERE id = ?").run(returnedAt, id);
      db.prepare("UPDATE books SET borrowed_by = '' WHERE id = ?").run(loan.bookId);
    }
    return this.getLoan(id);
  },
  getNotes(bookId) {
    return db.prepare("SELECT id, book_id AS bookId, content, created_at AS createdAt, updated_at AS updatedAt FROM book_notes WHERE book_id = ? ORDER BY created_at DESC, id DESC").all(bookId);
  },
  addNote(bookId, content) {
    const now = new Date().toISOString();
    const info = db.prepare("INSERT INTO book_notes (book_id, content, created_at, updated_at) VALUES (?, ?, ?, ?)").run(bookId, content, now, now);
    return this.getNote(info.lastInsertRowid);
  },
  getNote(id) {
    return db.prepare("SELECT id, book_id AS bookId, content, created_at AS createdAt, updated_at AS updatedAt FROM book_notes WHERE id = ?").get(id);
  },
  updateNote(id, content) {
    db.prepare("UPDATE book_notes SET content = ?, updated_at = ? WHERE id = ?").run(content, new Date().toISOString(), id);
    return this.getNote(id);
  },
  deleteNote(id) {
    db.prepare("DELETE FROM book_notes WHERE id = ?").run(id);
  },
  getAll() {
    const rows = db.prepare("SELECT * FROM books ORDER BY id DESC").all();
    const tagIdsByBook = getAllTagIdsByBook();
    const noteContentsByBook = getAllNoteContentsByBook();
    return rows.map((r) => ({
      ...rowToBook(r, tagIdsByBook),
      noteContents: noteContentsByBook.get(r.id) || [],
    }));
  },

  add(data) {
    const insert = db.prepare(`
      INSERT INTO books (title, author, genre, year, rating, pages, cover, description, featured, format, location, borrowed_by, notes)
      VALUES (@title, @author, @genre, @year, @rating, @pages, @cover, @description, @featured, @format, @location, @borrowed_by, @notes)
    `);
    let bookId;
    runInTransaction(() => {
      const info = insert.run({
        title: data.title,
        author: data.author,
        genre: data.genre,
        year: data.year,
        rating: data.rating,
        pages: data.pages,
        cover: data.cover || "",
        description: data.description || "",
        featured: data.featured ? 1 : 0,
        format: data.format || "Físico", location: data.location || "", borrowed_by: data.borrowedBy || "", notes: data.notes || "",
      });
      bookId = info.lastInsertRowid;
      const insertTag = db.prepare("INSERT INTO book_tags (book_id, tag_id) VALUES (?, ?)");
      (data.tagIds || []).forEach((tagId) => insertTag.run(bookId, tagId));
    });
    return bookId;
  },

  update(id, data) {
    runInTransaction(() => {
      db.prepare(`
        UPDATE books SET title=@title, author=@author, genre=@genre, year=@year, rating=@rating,
          pages=@pages, cover=@cover, description=@description, featured=@featured,
          format=@format, location=@location, borrowed_by=@borrowed_by, notes=@notes
        WHERE id=@id
      `).run({
        id,
        title: data.title,
        author: data.author,
        genre: data.genre,
        year: data.year,
        rating: data.rating,
        pages: data.pages,
        cover: data.cover || "",
        description: data.description || "",
        featured: data.featured ? 1 : 0,
        format: data.format || "Físico", location: data.location || "", borrowed_by: data.borrowedBy || "", notes: data.notes || "",
      });
      db.prepare("DELETE FROM book_tags WHERE book_id = ?").run(id);
      const insertTag = db.prepare("INSERT INTO book_tags (book_id, tag_id) VALUES (?, ?)");
      (data.tagIds || []).forEach((tagId) => insertTag.run(id, tagId));
    });
  },

  delete(id) {
    db.prepare("DELETE FROM books WHERE id = ?").run(id);
  },

  toggleRead(id) {
    db.prepare("UPDATE books SET is_read = NOT is_read WHERE id = ?").run(id);
  },

  toggleFavorite(id) {
    db.prepare("UPDATE books SET is_favorite = NOT is_favorite WHERE id = ?").run(id);
  },
};

const tagsApi = {
  getAll() {
    return db.prepare("SELECT * FROM tags ORDER BY id ASC").all();
  },

  add(data) {
    const info = db.prepare("INSERT INTO tags (name, color) VALUES (?, ?)").run(data.name, data.color);
    return info.lastInsertRowid;
  },

  update(id, data) {
    db.prepare("UPDATE tags SET name = ?, color = ? WHERE id = ?").run(data.name, data.color, id);
  },

  delete(id) {
    db.prepare("DELETE FROM tags WHERE id = ?").run(id);
  },
};

module.exports = { db, booksApi, tagsApi };
