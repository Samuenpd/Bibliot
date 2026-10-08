const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const SCHEMA_VERSION = 3;
const READING_STATUSES = new Set(["want_to_read", "reading", "completed"]);

function inTransaction(db, fn) {
  if (db.isTransaction) return fn();
  db.exec("BEGIN IMMEDIATE");
  try { const result = fn(); db.exec("COMMIT"); return result; }
  catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
}
function columns(db, table) { return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name)); }
function addColumn(db, table, name, definition) { if (!columns(db, table).has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`); }

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL COLLATE NOCASE, color TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS books (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, author TEXT NOT NULL, genre TEXT, year INTEGER, rating REAL DEFAULT 0, pages INTEGER DEFAULT 0, cover TEXT, description TEXT, featured INTEGER DEFAULT 0, is_read INTEGER DEFAULT 0, is_favorite INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS book_tags (book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE, tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY (book_id, tag_id));
    CREATE TABLE IF NOT EXISTS book_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE, content TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS book_loans (id INTEGER PRIMARY KEY AUTOINCREMENT, book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE, borrower TEXT NOT NULL, lent_at TEXT NOT NULL, due_at TEXT, returned_at TEXT);
  `);
  inTransaction(db, () => {
    for (const [name, definition] of [
      ["format", "TEXT NOT NULL DEFAULT 'Físico'"], ["location", "TEXT NOT NULL DEFAULT ''"], ["borrowed_by", "TEXT NOT NULL DEFAULT ''"], ["notes", "TEXT NOT NULL DEFAULT ''"], ["isbn", "TEXT NOT NULL DEFAULT ''"], ["edition", "TEXT NOT NULL DEFAULT ''"], ["publisher", "TEXT NOT NULL DEFAULT ''"], ["reading_status", "TEXT NOT NULL DEFAULT 'want_to_read'"], ["current_page", "INTEGER NOT NULL DEFAULT 0"], ["reading_started_at", "TEXT"], ["reading_completed_at", "TEXT"],
    ]) addColumn(db, "books", name, definition);
    db.exec(`
      UPDATE books SET reading_status = CASE WHEN is_read = 1 THEN 'completed' ELSE 'want_to_read' END WHERE reading_status IS NULL OR reading_status = '' OR reading_status NOT IN ('want_to_read','reading','completed');
      UPDATE books SET reading_status = 'completed' WHERE is_read = 1 AND reading_status = 'want_to_read';
      CREATE TABLE IF NOT EXISTS reading_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE, started_at TEXT, completed_at TEXT, current_page INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL CHECK(status IN ('want_to_read','reading','completed')));
      CREATE INDEX IF NOT EXISTS idx_books_isbn ON books(isbn);
      CREATE INDEX IF NOT EXISTS idx_books_reading_status ON books(reading_status);
      CREATE INDEX IF NOT EXISTS idx_reading_sessions_book ON reading_sessions(book_id, id DESC);
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, datetime('now')), (2, datetime('now')), (3, datetime('now'));
      PRAGMA user_version = ${SCHEMA_VERSION};
    `);
    for (const group of db.prepare("SELECT lower(name) normalized, group_concat(id) ids FROM tags GROUP BY lower(name) HAVING count(*) > 1").all()) {
      const ids=String(group.ids).split(",").map(Number), keeper=ids.shift();
      for (const duplicate of ids) {
        db.prepare("INSERT OR IGNORE INTO book_tags(book_id,tag_id) SELECT book_id,? FROM book_tags WHERE tag_id=?").run(keeper,duplicate);
        db.prepare("DELETE FROM book_tags WHERE tag_id=?").run(duplicate);
        db.prepare("DELETE FROM tags WHERE id=?").run(duplicate);
      }
    }
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name_nocase ON tags(name COLLATE NOCASE);
      INSERT INTO reading_sessions(book_id,started_at,completed_at,current_page,status)
      SELECT id,NULL,NULL,CASE WHEN pages > 0 THEN pages ELSE current_page END,'completed' FROM books b
      WHERE b.is_read=1 AND NOT EXISTS(SELECT 1 FROM reading_sessions r WHERE r.book_id=b.id);
    `);
    for (const tag of [{ name: "Laura", color: "#d97148" }, { name: "Silvia", color: "#e8a0a8" }]) db.prepare("INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)").run(tag.name, tag.color);
  });
}

function normalizeText(value = "") { return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function normalizeIsbn(value = "") {
  const isbn = String(value).replace(/[^0-9Xx]/g, "").toUpperCase();
  if (![10, 13].includes(isbn.length)) return "";
  if (isbn.length === 10) return [...isbn].reduce((sum, c, i) => sum + (c === "X" ? 10 : Number(c)) * (10 - i), 0) % 11 === 0 ? isbn : "";
  const sum = [...isbn.slice(0, 12)].reduce((total, c, i) => total + Number(c) * (i % 2 ? 3 : 1), 0);
  return (10 - sum % 10) % 10 === Number(isbn[12]) ? isbn : "";
}
function duplicateMatches(candidate, books) {
  const isbn = normalizeIsbn(candidate.isbn), title = normalizeText(candidate.title), author = normalizeText(candidate.author), edition = normalizeText(candidate.edition), publisher = normalizeText(candidate.publisher);
  return books.map((book) => {
    const bookIsbn = normalizeIsbn(book.isbn);
    if (isbn && bookIsbn && isbn === bookIsbn) return { book, confidence: "strong", reasons: ["ISBN igual"] };
    if (!title || !author || title !== normalizeText(book.title) || author !== normalizeText(book.author)) return null;
    const reasons = ["Título e autor iguais"];
    if (edition && normalizeText(book.edition) === edition) reasons.push("Edição igual");
    if (publisher && normalizeText(book.publisher) === publisher) reasons.push("Editora igual");
    return { book, confidence: "probable", reasons };
  }).filter(Boolean);
}
function validateBook(data) {
  if (!data || typeof data !== "object") throw new Error("Dados do livro inválidos.");
  const title = String(data.title || "").trim(), author = String(data.author || "").trim();
  if (!title || !author) throw new Error("Título e autor são obrigatórios.");
  const pages = Number(data.pages || 0), currentPage = Number(data.currentPage || 0);
  if (!Number.isInteger(pages) || pages < 0 || !Number.isInteger(currentPage) || currentPage < 0 || (pages > 0 && currentPage > pages)) throw new Error("Progresso de leitura inválido.");
  return { ...data, title, author, pages, currentPage, readingStatus: READING_STATUSES.has(data.readingStatus) ? data.readingStatus : "want_to_read", isbn: String(data.isbn || "").trim() };
}

function createLibrary(storageRoot) {
  fs.mkdirSync(storageRoot, { recursive: true }); fs.mkdirSync(path.join(storageRoot, "covers"), { recursive: true });
  const dbPath = path.join(storageRoot, "biblioteca.db"), db = new DatabaseSync(dbPath);
  try { db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;"); migrate(db); }
  catch(error){ try{db.close();}catch{} throw error; }
  const tagMap = () => { const map = new Map(); for (const row of db.prepare("SELECT book_id, tag_id FROM book_tags").all()) { if (!map.has(row.book_id)) map.set(row.book_id, []); map.get(row.book_id).push(Number(row.tag_id)); } return map; };
  const rowToBook = (row, tags = tagMap()) => ({ id:Number(row.id), title:row.title, author:row.author, genre:row.genre||"", year:Number(row.year||0), rating:Number(row.rating||0), pages:Number(row.pages||0), cover:row.cover||"", description:row.description||"", featured:!!row.featured, isRead:row.reading_status==="completed", isFavorite:!!row.is_favorite, tagIds:tags.get(row.id)||[], format:row.format||"Físico", location:row.location||"", borrowedBy:row.borrowed_by||"", notes:row.notes||"", isbn:row.isbn||"", edition:row.edition||"", publisher:row.publisher||"", readingStatus:row.reading_status||"want_to_read", currentPage:Number(row.current_page||0), readingStartedAt:row.reading_started_at||null, readingCompletedAt:row.reading_completed_at||null });
  const getAll = () => { const tags=tagMap(), notes=new Map(); for(const row of db.prepare("SELECT book_id,content FROM book_notes ORDER BY created_at DESC,id DESC").all()){if(!notes.has(row.book_id))notes.set(row.book_id,[]);notes.get(row.book_id).push(row.content);} return db.prepare("SELECT * FROM books ORDER BY id DESC").all().map(row=>({...rowToBook(row,tags),noteContents:notes.get(row.id)||[]})); };
  const getBook = id => { const row=db.prepare("SELECT * FROM books WHERE id=?").get(Number(id)); return row?rowToBook(row):null; };
  const writeTags=(bookId,ids)=>{db.prepare("DELETE FROM book_tags WHERE book_id=?").run(bookId);const stmt=db.prepare("INSERT OR IGNORE INTO book_tags(book_id,tag_id) VALUES (?,?)");for(const id of ids||[])stmt.run(bookId,Number(id));};
  const values=data=>{const d=validateBook(data);return {title:d.title,author:d.author,genre:String(d.genre||""),year:Number(d.year||0),rating:Number(d.rating||0),pages:d.pages,cover:String(d.cover||""),description:String(d.description||""),featured:d.featured?1:0,format:String(d.format||"Físico"),location:String(d.location||""),borrowed_by:String(d.borrowedBy||""),notes:String(d.notes||""),isbn:d.isbn,edition:String(d.edition||""),publisher:String(d.publisher||""),reading_status:d.readingStatus,current_page:d.currentPage,reading_started_at:d.readingStartedAt||null,reading_completed_at:d.readingCompletedAt||null};};
  const booksApi={
    getAll,get:id=>getBook(id),findDuplicates:(data,excludeId=null)=>duplicateMatches(data,getAll().filter(b=>b.id!==Number(excludeId))),
    add(data){const d=values(data);return inTransaction(db,()=>{const keys=Object.keys(d),info=db.prepare(`INSERT INTO books (${keys.join(",")}) VALUES (${keys.map(k=>"@"+k).join(",")})`).run(d),id=Number(info.lastInsertRowid);writeTags(id,data.tagIds);return id;});},
    update(id,data){const d=values(data);return inTransaction(db,()=>{const keys=Object.keys(d);db.prepare(`UPDATE books SET ${keys.map(k=>`${k}=@${k}`).join(",")} WHERE id=@id`).run({...d,id:Number(id)});writeTags(Number(id),data.tagIds);});},delete:id=>db.prepare("DELETE FROM books WHERE id=?").run(Number(id)),toggleFavorite:id=>db.prepare("UPDATE books SET is_favorite=NOT is_favorite WHERE id=?").run(Number(id)),
    getReadingSessions:bookId=>db.prepare("SELECT id,book_id bookId,started_at startedAt,completed_at completedAt,current_page currentPage,status FROM reading_sessions WHERE book_id=? ORDER BY id DESC").all(Number(bookId)),
    updateReading(bookId,input){const id=Number(bookId),book=getBook(id);if(!book)throw new Error("Livro não encontrado.");const status=String(input.status||book.readingStatus);if(!READING_STATUSES.has(status))throw new Error("Estado de leitura inválido.");let page=Number(input.currentPage??book.currentPage);if(!Number.isInteger(page)||page<0||(book.pages>0&&page>book.pages))throw new Error("A página atual deve estar entre zero e o total de páginas.");const now=new Date().toISOString();let started=input.startedAt??book.readingStartedAt,completed=input.completedAt??book.readingCompletedAt;return inTransaction(db,()=>{let session=db.prepare("SELECT * FROM reading_sessions WHERE book_id=? AND status!='completed' ORDER BY id DESC LIMIT 1").get(id);if(status==="reading"&&!session){started=started||now;const info=db.prepare("INSERT INTO reading_sessions(book_id,started_at,current_page,status) VALUES (?,?,?,'reading')").run(id,started,page);session={id:info.lastInsertRowid};}if(status==="completed"){completed=completed||now;if(book.pages>0)page=book.pages;if(session)db.prepare("UPDATE reading_sessions SET current_page=?,status='completed',completed_at=? WHERE id=?").run(page,completed,session.id);else db.prepare("INSERT INTO reading_sessions(book_id,started_at,completed_at,current_page,status) VALUES (?,?,?,?, 'completed')").run(id,started||null,completed,page);}else if(session)db.prepare("UPDATE reading_sessions SET current_page=?,status=?,started_at=? WHERE id=?").run(page,status,started||null,session.id);if(status==="want_to_read"){page=0;started=null;completed=null;}db.prepare("UPDATE books SET reading_status=?,current_page=?,reading_started_at=?,reading_completed_at=?,is_read=? WHERE id=?").run(status,page,started||null,completed||null,status==="completed"?1:0,id);return getBook(id);});},
    startReread(bookId,startedAt){const id=Number(bookId);if(!getBook(id))throw new Error("Livro não encontrado.");const start=startedAt||new Date().toISOString();return inTransaction(db,()=>{db.prepare("INSERT INTO reading_sessions(book_id,started_at,current_page,status) VALUES (?,?,0,'reading')").run(id,start);db.prepare("UPDATE books SET reading_status='reading',current_page=0,reading_started_at=?,reading_completed_at=NULL,is_read=0 WHERE id=?").run(start,id);return getBook(id);});},
    getNotes:bookId=>db.prepare("SELECT id,book_id bookId,content,created_at createdAt,updated_at updatedAt FROM book_notes WHERE book_id=? ORDER BY created_at DESC,id DESC").all(Number(bookId)),addNote(bookId,content){const text=String(content||"").trim();if(!text)throw new Error("Anotação vazia.");const now=new Date().toISOString(),info=db.prepare("INSERT INTO book_notes(book_id,content,created_at,updated_at) VALUES (?,?,?,?)").run(Number(bookId),text,now,now);return db.prepare("SELECT id,book_id bookId,content,created_at createdAt,updated_at updatedAt FROM book_notes WHERE id=?").get(info.lastInsertRowid);},updateNote(id,content){db.prepare("UPDATE book_notes SET content=?,updated_at=? WHERE id=?").run(String(content||"").trim(),new Date().toISOString(),Number(id));return db.prepare("SELECT id,book_id bookId,content,created_at createdAt,updated_at updatedAt FROM book_notes WHERE id=?").get(Number(id));},deleteNote:id=>db.prepare("DELETE FROM book_notes WHERE id=?").run(Number(id)),
    getLoans:bookId=>db.prepare("SELECT id,book_id bookId,borrower,lent_at lentAt,due_at dueAt,returned_at returnedAt FROM book_loans WHERE book_id=? ORDER BY lent_at DESC,id DESC").all(Number(bookId)),addLoan(bookId,borrower,lentAt,dueAt){const id=Number(bookId);if(db.prepare("SELECT 1 FROM book_loans WHERE book_id=? AND returned_at IS NULL").get(id))throw new Error("Este livro já possui um empréstimo em aberto.");const info=db.prepare("INSERT INTO book_loans(book_id,borrower,lent_at,due_at) VALUES (?,?,?,?)").run(id,String(borrower).trim(),lentAt,dueAt||null);db.prepare("UPDATE books SET borrowed_by=? WHERE id=?").run(String(borrower).trim(),id);return db.prepare("SELECT id,book_id bookId,borrower,lent_at lentAt,due_at dueAt,returned_at returnedAt FROM book_loans WHERE id=?").get(info.lastInsertRowid);},returnLoan(id){const loan=db.prepare("SELECT id,book_id bookId,borrower,lent_at lentAt,due_at dueAt,returned_at returnedAt FROM book_loans WHERE id=?").get(Number(id));if(!loan)throw new Error("Empréstimo não encontrado.");if(!loan.returnedAt){db.prepare("UPDATE book_loans SET returned_at=? WHERE id=?").run(new Date().toISOString(),Number(id));db.prepare("UPDATE books SET borrowed_by='' WHERE id=?").run(loan.bookId);}return db.prepare("SELECT id,book_id bookId,borrower,lent_at lentAt,due_at dueAt,returned_at returnedAt FROM book_loans WHERE id=?").get(Number(id));}
  };
  const tagsApi={getAll:()=>db.prepare("SELECT * FROM tags ORDER BY id").all(),add:data=>Number(db.prepare("INSERT INTO tags(name,color) VALUES (?,?)").run(String(data.name).trim(),String(data.color)).lastInsertRowid),update:(id,data)=>db.prepare("UPDATE tags SET name=?,color=? WHERE id=?").run(String(data.name).trim(),String(data.color),Number(id)),delete:id=>db.prepare("DELETE FROM tags WHERE id=?").run(Number(id))};
  return {db,dbPath,storageRoot,booksApi,tagsApi,close:()=>db.close(),integrityCheck:()=>db.prepare("PRAGMA integrity_check").all().every(row=>Object.values(row)[0]==="ok")};
}
module.exports={createLibrary,migrate,normalizeText,normalizeIsbn,duplicateMatches,SCHEMA_VERSION,inTransaction};
