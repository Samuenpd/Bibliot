// Run with: electron test/settings.smoke.cjs
// Uses an isolated library and hidden window; never opens the user's library.
const { app, BrowserWindow, ipcMain } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createLibrary } = require("../electron/db.cjs");
const { createDataService } = require("../electron/data-service.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "bibip-settings-smoke-"));
app.setPath("userData", path.join(root, "profile"));
let library, win;
let opened = 0, cleared = 0;
const pause = () => new Promise(resolve => setTimeout(resolve, 50));
const evaluate = source => win.webContents.executeJavaScript(source);
async function until(source) {
  for (let i = 0; i < 200; i++) {
    if (await evaluate(source)) return;
    await pause();
  }
  throw new Error(`Timed out: ${source}`);
}
const click = text => evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`);
const type = value => evaluate(`{
  const input=document.getElementById('delete-library-confirmation');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
  input.dispatchEvent(new Event('input',{bubbles:true}));
}`);
const typeSelector = (selector, value) => evaluate(`{
  const input=document.querySelector(${JSON.stringify(selector)});
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
  input.dispatchEvent(new Event('input',{bubbles:true}));
}`);

app.whenReady().then(async () => {
  try {
    library = createLibrary(path.join(root, "library"));
    library.booksApi.add({ title: "Smoke test", author: "Test", pages: 100 });
    fs.writeFileSync(path.join(library.storageRoot, "covers", "test.jpg"), "test");
    const service = createDataService(() => library, async () => {});
    ipcMain.handle("books:getAll", () => library.booksApi.getAll());
    ipcMain.handle("books:add", (_event, data) => library.booksApi.add(data));
    ipcMain.handle("books:findDuplicates", (_event, data) => library.booksApi.findDuplicates(data));
    ipcMain.handle("genres:getAll", () => library.genresApi.getAll());
    ipcMain.handle("genres:add", (_event, name) => library.genresApi.add(name));
    ipcMain.handle("tags:getAll", () => library.tagsApi.getAll());
    ipcMain.handle("settings:getStoragePath", () => library.storageRoot);
    ipcMain.handle("settings:getStorageWarning", () => null);
    ipcMain.handle("settings:openStoragePath", () => { opened++; });
    ipcMain.handle("data:clearLibrary", (_event, confirmation) => {
      cleared++;
      return service.clearLibrary(confirmation);
    });
    win = new BrowserWindow({ show: false, width: 1280, height: 1000, webPreferences: {
      preload: path.join(__dirname, "..", "electron", "preload.cjs"), contextIsolation: true, nodeIntegration: false,
    } });
    await win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
    await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Configurações')`);
    await click("Cadastrar");
    await until(`!!document.querySelector('[aria-label="Selecionar gênero"]')`);
    await evaluate(`document.querySelector('[aria-label="Selecionar gênero"]').click()`);
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Novo gênero').className.includes('hover:bg-accent')`), true);
    await evaluate(`document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);
    await until(`!Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Novo gênero')`);
    await evaluate(`document.querySelector('[aria-label="Selecionar gênero"]').click()`);
    await click("Novo gênero");
    await until(`!!document.getElementById('new-genre')`);
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Adicionar gênero').disabled`), true);
    await typeSelector("#new-genre", "Space Opera");
    await evaluate(`document.getElementById('new-genre').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
    await until(`document.querySelector('[aria-label="Selecionar gênero"]').textContent.includes('Space Opera')`);
    assert.equal(library.booksApi.getAll().length, 1, "Enter no gênero não pode cadastrar o livro");
    assert.ok(library.genresApi.getAll().includes("Space Opera"));
    await evaluate(`document.querySelector('[aria-label="Selecionar formato"]').click()`);
    await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='E-book')`);
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='E-book').className.includes('hover:bg-accent')`), true);
    await click("E-book");
    await until(`document.querySelector('[aria-label="Selecionar formato"]').textContent.includes('E-book')`);
    await typeSelector('input[placeholder="Nome do livro"]', "Livro espacial");
    await typeSelector('input[placeholder="Nome do autor"]', "Autora");
    await click("Adicionar ao acervo");
    await until(`!document.querySelector('[aria-label="Selecionar gênero"]')`);
    await click("Space Opera");
    await until(`document.querySelector('main').textContent.includes('Livro espacial')&&!document.querySelector('main').textContent.includes('Smoke test')`);
    assert.equal(library.booksApi.getAll().find(book=>book.title==="Livro espacial").genre, "Space Opera");
    await click("Configurações");
    await until(`document.querySelector('h1')?.textContent==='Configurações'`);
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('main h2')).map(h=>h.textContent)`), [
      "Paleta de cores", "Atalhos de teclado", "Local de armazenamento", "Backup e restauração", "Importação e exportação", "Excluir tudo",
    ]);
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('main h2')).slice(0,3).every(h=>h.parentElement.closest('section')===h.parentElement.parentElement||h.textContent==='Paleta de cores')`), true);
    await click("Abrir pasta");
    await until(`true`);
    assert.equal(opened, 1);
    await click("Excluir todos os dados");
    await until(`!!document.querySelector('[role="alertdialog"]')`);
    assert.equal(await evaluate(`document.querySelector('[role="alertdialog"] button[type="submit"]').disabled`), true);
    await type("BIBIP");
    await evaluate(`document.querySelector('[role="alertdialog"] form').requestSubmit()`);
    assert.equal(cleared, 0);
    assert.equal(library.booksApi.getAll().length, 2);
    await click("Cancelar");
    await until(`!document.querySelector('[role="alertdialog"]')`);
    assert.equal(library.booksApi.getAll().length, 2);
    await click("Excluir todos os dados");
    await until(`!!document.getElementById('delete-library-confirmation')`);
    assert.equal(await evaluate(`document.getElementById('delete-library-confirmation').value`), "");
    await type("bibip");
    await until(`!document.querySelector('[role="alertdialog"] button[type="submit"]').disabled`);
    await click("Confirmar exclusão");
    await until(`!document.querySelector('[role="alertdialog"]')`);
    assert.equal(cleared, 1);
    assert.deepEqual(library.booksApi.getAll(), []);
    assert.deepEqual(library.tagsApi.getAll(), []);
    assert.deepEqual(fs.readdirSync(path.join(library.storageRoot, "covers")), []);
    assert.equal(library.genresApi.getAll().includes("Space Opera"), false);
    console.log("UI smoke test passed: create genre, save book, filter catalog, settings and deletion.");
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    if (library) library.close();
  }
});
