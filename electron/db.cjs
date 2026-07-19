const path = require("path");
const { app } = require("electron");
const { DatabaseSync } = require("node:sqlite");

const DB_PATH = path.join(app.getPath("userData"), "biblioteca.db");

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
`);

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

// ── API pública do "backend" ─────────────────────────────────────────────

const booksApi = {
  getAll() {
    const rows = db.prepare("SELECT * FROM books ORDER BY id DESC").all();
    const tagIdsByBook = getAllTagIdsByBook();
    return rows.map((r) => rowToBook(r, tagIdsByBook));
  },

  add(data) {
    const insert = db.prepare(`
      INSERT INTO books (title, author, genre, year, rating, pages, cover, description, featured)
      VALUES (@title, @author, @genre, @year, @rating, @pages, @cover, @description, @featured)
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
          pages=@pages, cover=@cover, description=@description, featured=@featured
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
