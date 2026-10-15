const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createLibrary } = require("../electron/db.cjs");
const { storageDirectory, initializeStorage, copyLibrary, saveStoragePath } = require("../electron/storage-service.cjs");

const roots = [];
const temp = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), "bibip-storage-test-")); roots.push(root); return root; };
test.after(() => roots.forEach(root => fs.rmSync(root, { recursive: true, force: true })));

test("a seleção usa a subpasta Bi-Bip sem criar pastas duplicadas", () => {
  const selected = temp();
  assert.equal(storageDirectory(selected), path.join(selected, "Bi-Bip"));
  assert.equal(storageDirectory(path.join(selected, "Bi-Bip")), path.join(selected, "Bi-Bip"));
  assert.equal(storageDirectory(path.join(selected, "bi-bip")), path.join(selected, "bi-bip"));
  for (const invalid of [undefined, "", "relative/path", 123]) assert.throws(() => storageDirectory(invalid));
});

test("migra caminho antigo, incluindo WAL aberto, sem alterar os arquivos originais", async () => {
  const parent = temp(), source = path.join(parent, "Programs"), config = path.join(parent, "profile", "storage.json");
  const lib = createLibrary(source);
  try {
    const tagId = lib.tagsApi.add({ name: "Especial", color: "#123456" });
    const id = lib.booksApi.add({ title: "Preservar", author: "Autora", pages: 100, tagIds: [tagId] });
    lib.booksApi.addNote(id, "Minha nota");lib.booksApi.addLoan(id, "Ana", "2026-01-01", null);
    lib.booksApi.updateReading(id, { status: "reading", currentPage: 12 });
    fs.writeFileSync(path.join(source, "covers", "capa.jpg"), "capa");
    fs.writeFileSync(path.join(source, "outro-app.lnk"), "preservar atalho");
    fs.mkdirSync(path.dirname(config), { recursive: true });
    fs.writeFileSync(config, JSON.stringify({ path: source }));
    const destination = await initializeStorage(config, path.join(parent, "default", "Bi-Bip"));
    assert.equal(destination, path.join(source, "Bi-Bip"));
    assert.equal(JSON.parse(fs.readFileSync(config)).path, destination);
    const copy = createLibrary(destination);
    try {
      assert.equal(copy.booksApi.getAll()[0].title, "Preservar");
      assert.equal(copy.booksApi.getAll()[0].currentPage, 12);
      assert.equal(copy.booksApi.getNotes(id)[0].content, "Minha nota");
      assert.equal(copy.booksApi.getLoans(id)[0].borrower, "Ana");
      assert.equal(copy.tagsApi.getAll().find(tag => tag.id === tagId).color, "#123456");
      assert.equal(fs.readFileSync(path.join(destination, "covers", "capa.jpg"), "utf8"), "capa");
    } finally { copy.close(); }
    assert.equal(lib.booksApi.getAll()[0].title, "Preservar");
    assert.equal(fs.readFileSync(path.join(source, "outro-app.lnk"), "utf8"), "preservar atalho");
    assert.equal(fs.readFileSync(path.join(source, "covers", "capa.jpg"), "utf8"), "capa");
    assert.equal(await initializeStorage(config, path.join(parent, "default", "Bi-Bip")), destination);
    assert.equal(fs.existsSync(path.join(destination, "Bi-Bip")), false);
  } finally { lib.close(); }
});

test("migração nunca sobrescreve uma biblioteca de destino existente", async () => {
  const root = temp(), source = createLibrary(path.join(root, "original")), destination = createLibrary(path.join(source.storageRoot, "Bi-Bip"));
  const config = path.join(root, "storage.json");
  try {
    source.booksApi.add({ title: "Origem", author: "A" });
    destination.booksApi.add({ title: "Destino", author: "B" });
    fs.writeFileSync(config, JSON.stringify({ path: source.storageRoot }));
    await assert.rejects(initializeStorage(config, path.join(root, "default", "Bi-Bip")), /Nenhum arquivo foi sobrescrito/);
    assert.equal(source.booksApi.getAll()[0].title, "Origem");
    assert.equal(destination.booksApi.getAll()[0].title, "Destino");
    assert.equal(JSON.parse(fs.readFileSync(config)).path, source.storageRoot);
  } finally { source.close();destination.close(); }
});

test("pasta nova, padrão e configuração persistida mantêm o caminho correto", async () => {
  const root = temp(), config = path.join(root, "profile", "storage.json"), defaultRoot = path.join(root, "profile", "Bi-Bip");
  assert.equal(await initializeStorage(config, defaultRoot), defaultRoot);
  const chosenParent = path.join(root, "external");
  fs.mkdirSync(path.dirname(config), { recursive: true });
  fs.writeFileSync(config, JSON.stringify({ path: chosenParent }));
  const selected = await initializeStorage(config, defaultRoot);
  assert.equal(selected, path.join(chosenParent, "Bi-Bip"));
  assert.ok(fs.statSync(selected).isDirectory());
  saveStoragePath(config, selected);
  assert.equal(await initializeStorage(config, defaultRoot), selected);
});

test("cópia inválida não deixa banco parcial nem permite destino dentro das capas", async () => {
  const root = temp(), source = createLibrary(path.join(root, "source"));
  try {
    await assert.rejects(copyLibrary(source.storageRoot, path.join(source.storageRoot, "covers", "Bi-Bip")), /fora da pasta de capas/);
    const badSource = path.join(root, "invalid"), target = path.join(root, "target", "Bi-Bip");
    fs.mkdirSync(badSource);fs.writeFileSync(path.join(badSource, "biblioteca.db"), "invalid sqlite");
    await assert.rejects(copyLibrary(badSource, target));
    assert.equal(fs.existsSync(path.join(target, "biblioteca.db")), false);
    assert.equal(fs.readdirSync(target).some(name => name.startsWith(".bibip-copy-")), false);
  } finally { source.close(); }
});
