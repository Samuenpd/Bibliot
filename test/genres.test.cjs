const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createLibrary, SCHEMA_VERSION } = require("../electron/db.cjs");
const { DEFAULT_GENRES } = require("../electron/genres.cjs");
const { createDataService } = require("../electron/data-service.cjs");
const roots = [];
const temp = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), "bibip-genres-"));roots.push(root);return root; };
test.after(() => roots.forEach(root => fs.rmSync(root, { recursive: true, force: true })));

test("gênero personalizado persiste sem livros e evita duplicatas de caixa, espaços e acentos", () => {
  const root = temp();let lib = createLibrary(root);
  try {
    assert.deepEqual(lib.genresApi.getAll(), DEFAULT_GENRES);
    assert.equal(lib.genresApi.add("  Ficção   científica "), "Ficção científica");
    assert.equal(lib.genresApi.add("ficcao cientifica"), "Ficção científica");
    assert.equal(lib.genresApi.add("ROMANCE"), "Romance");
    assert.equal(lib.db.prepare("SELECT count(*) total FROM genres").get().total, 1);
    lib.close();lib = createLibrary(root);
    assert.ok(lib.genresApi.getAll().includes("Ficção científica"));
    assert.equal(lib.booksApi.getAll().length, 0);
    assert.equal(lib.db.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
    for (const invalid of [null, 123, "", "  ", "Todos", "todos", "a".repeat(81)]) assert.throws(() => lib.genresApi.add(invalid));
  } finally { lib.close(); }
});

test("gêneros de livros importados aparecem nas opções e podem ser reutilizados", () => {
  const lib = createLibrary(temp());
  try {
    const service = createDataService(() => lib, async () => {}), file = path.join(temp(), "genres.csv");
    fs.writeFileSync(file, "title;author;genre\nLivro espacial;Autora;Space Opera");
    const preview = service.previewImport(file);service.importRows(preview.rows, [0]);
    assert.ok(lib.genresApi.getAll().includes("Space Opera"));
    assert.equal(lib.genresApi.add("space opera"), "Space Opera");
    const book = lib.booksApi.getAll()[0];lib.booksApi.delete(book.id);
    assert.ok(lib.genresApi.getAll().includes("Space Opera"));
  } finally { lib.close(); }
});

test("backup recupera gêneros personalizados e excluir tudo remove os personalizados", async () => {
  const root = temp();let lib = createLibrary(root);
  const service = createDataService(() => lib, async operation => {
    lib.close();try { await operation(root); } finally { lib = createLibrary(root); }
  });
  try {
    lib.genresApi.add("Space Opera");
    const backupFile = path.join(temp(), "backup.zip");await service.createBackup(backupFile);
    service.clearLibrary("bibip");assert.deepEqual(lib.genresApi.getAll(), DEFAULT_GENRES);
    await service.restoreBackup(backupFile);assert.ok(lib.genresApi.getAll().includes("Space Opera"));
    service.clearLibrary("bibip");lib.close();lib = createLibrary(root);
    assert.deepEqual(lib.genresApi.getAll(), DEFAULT_GENRES);
  } finally { lib.close(); }
});

test("atualiza biblioteca da versão 3 preservando os livros e seus gêneros", () => {
  const root = temp();let lib = createLibrary(root);
  try {
    lib.booksApi.add({ title: "Antigo", author: "A", genre: "Ensaios" });
    lib.db.exec("DROP TABLE genres;DELETE FROM schema_migrations WHERE version=4;PRAGMA user_version=3;");
    lib.close();lib = createLibrary(root);
    assert.equal(lib.booksApi.getAll()[0].title, "Antigo");
    assert.ok(lib.genresApi.getAll().includes("Ensaios"));
    assert.equal(lib.genresApi.add("Crônicas"), "Crônicas");
  } finally { lib.close(); }
});
