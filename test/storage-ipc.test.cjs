const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { createLibrary } = require("../electron/db.cjs");

test("IPC real migra, seleciona, persiste e abre a mesma pasta do acervo", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bibip-storage-ipc-"));
  const profile = path.join(root, "profile"), legacyRoot = path.join(root, "Programs");
  const migratedRoot = path.join(legacyRoot, "Bi-Bip"), newParent = path.join(root, "external"), newRoot = path.join(newParent, "Bi-Bip");
  const legacy = createLibrary(legacyRoot);
  legacy.booksApi.add({ title: "Preservar meu acervo", author: "Autora", pages: 100 });legacy.close();
  fs.mkdirSync(profile);fs.writeFileSync(path.join(profile, "storage.json"), JSON.stringify({ path: legacyRoot }));
  const handlers = new Map(), events = new Map(), opened = [], backendErrors = [];
  let selection = newParent, shellError = "", window, startupResolve, startupReject;
  const startup = new Promise((resolve, reject) => { startupResolve = resolve;startupReject = reject; });
  class Window {
    constructor() { window = this;this.webContents = { send() {}, openDevTools() {} }; }
    loadFile() { startupResolve(); }
    static getAllWindows() { return window ? [window] : []; }
  }
  const mainPath = path.join(__dirname, "..", "electron", "main.cjs"), mainRequire = createRequire(mainPath);
  const electron = {
    app: { setName() {}, getPath: () => profile, whenReady: () => Promise.resolve(), on: (name, fn) => events.set(name, fn), quit() { startupReject(new Error("Unexpected startup failure")); } },
    BrowserWindow: Window, ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    protocol: { registerSchemesAsPrivileged() {}, handle() {} }, net: {},
    shell: { openPath: async folder => { opened.push(folder);return shellError; } },
    dialog: {
      showOpenDialog: async () => ({ canceled: selection === null, filePaths: selection ? [selection] : [] }),
      showMessageBox: async () => ({ response: 0 }),
      showErrorBox: (title, message) => startupReject(new Error(`${title}: ${message}`)),
    },
  };
  const invoke = (name, ...args) => handlers.get(name)(null, ...args);
  try {
    vm.runInNewContext(fs.readFileSync(mainPath, "utf8"), {
      require: name => name === "electron" ? electron : mainRequire(name),
      __dirname: path.dirname(mainPath), process: { ...process, env: { ...process.env, NODE_ENV: "test" } }, console: { ...console, error: (...args) => backendErrors.push(args) }, Buffer, URL, fetch,
    }, { filename: mainPath });
    await startup;
    assert.equal(await invoke("settings:getStoragePath"), migratedRoot);
    assert.equal((await invoke("books:getAll"))[0].title, "Preservar meu acervo");
    await invoke("settings:openStoragePath");assert.equal(opened.at(-1), migratedRoot);
    assert.equal(await invoke("settings:chooseStoragePath"), newRoot);
    await invoke("settings:openStoragePath");assert.equal(opened.at(-1), newRoot);
    assert.equal(JSON.parse(fs.readFileSync(path.join(profile, "storage.json"))).path, newRoot);
    assert.equal((await invoke("books:getAll"))[0].title, "Preservar meu acervo");
    selection = newRoot;
    assert.equal(await invoke("settings:chooseStoragePath"), newRoot);
    assert.equal(fs.existsSync(path.join(newRoot, "Bi-Bip")), false);
    selection = null;
    assert.equal(await invoke("settings:chooseStoragePath"), null);
    assert.equal(await invoke("settings:getStoragePath"), newRoot);
    const existingParent = path.join(root, "existing"), existingRoot = path.join(existingParent, "Bi-Bip");
    const existing = createLibrary(existingRoot);
    existing.booksApi.add({ title: "Outra biblioteca", author: "B" });existing.close();
    selection = existingParent;
    assert.equal(await invoke("settings:chooseStoragePath"), existingRoot);
    await invoke("settings:openStoragePath");assert.equal(opened.at(-1), existingRoot);
    assert.equal((await invoke("books:getAll"))[0].title, "Outra biblioteca");
    shellError = "access denied";
    await assert.rejects(invoke("settings:openStoragePath"), /access denied/);
    assert.equal(backendErrors.length, 1);
    assert.equal(await invoke("settings:getStoragePath"), existingRoot);
  } finally {
    if (window) events.get("window-all-closed")();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
