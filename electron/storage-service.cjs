const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync, backup } = require("node:sqlite");
const { createLibrary } = require("./db.cjs");

function storageDirectory(selectedPath) {
  if (typeof selectedPath !== "string" || !path.isAbsolute(selectedPath)) {
    throw new Error("Escolha uma pasta de armazenamento válida.");
  }
  const selected = path.resolve(selectedPath);
  return path.basename(selected).toLowerCase() === "bi-bip" ? selected : path.join(selected, "Bi-Bip");
}

function saveStoragePath(configPath, root, unavailablePath = null) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const temporary = `${configPath}.${process.pid}.tmp`;
  try {
    const config = { version: 2, path: path.resolve(root) };
    if (unavailablePath) config.unavailablePath = path.resolve(unavailablePath);
    fs.writeFileSync(temporary, JSON.stringify(config, null, 2));
    fs.renameSync(temporary, configPath);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

async function copyLibrary(sourceRoot, destinationRoot) {
  const source = path.resolve(sourceRoot), destination = path.resolve(destinationRoot);
  if (source === destination) return;
  const sourceCovers = path.join(source, "covers");
  const relativeToCovers = path.relative(sourceCovers, destination);
  if (!relativeToCovers || (!relativeToCovers.startsWith(`..${path.sep}`) && relativeToCovers !== ".." && !path.isAbsolute(relativeToCovers))) {
    throw new Error("Escolha uma pasta fora da pasta de capas atual.");
  }
  fs.mkdirSync(destination, { recursive: true });
  const destinationDb = path.join(destination, "biblioteca.db");
  const destinationCovers = path.join(destination, "covers");
  if (fs.existsSync(destinationDb) || fs.existsSync(destinationCovers)) {
    throw new Error("A pasta Bi-Bip de destino já contém dados. Nenhum arquivo foi sobrescrito.");
  }
  const staging = fs.mkdtempSync(path.join(destination, ".bibip-copy-"));
  const stagedDb = path.join(staging, "biblioteca.db");
  const stagedCovers = path.join(staging, "covers");
  try {
    // SQLite backup includes committed WAL data, even if another app has the source open.
    const sourceDb = new DatabaseSync(path.join(source, "biblioteca.db"), { readOnly: true });
    try { await backup(sourceDb, stagedDb); } finally { sourceDb.close(); }
    if (fs.existsSync(sourceCovers)) {
      if (fs.lstatSync(sourceCovers).isSymbolicLink()) throw new Error("A pasta de capas não pode ser um link para outra pasta.");
      fs.cpSync(sourceCovers, stagedCovers, { recursive: true });
    }
    const candidate = createLibrary(staging);
    try {
      if (!candidate.integrityCheck()) throw new Error("A cópia da biblioteca não passou na validação.");
    } finally { candidate.close(); }
    fs.renameSync(stagedCovers, destinationCovers);
    try { fs.renameSync(stagedDb, destinationDb); }
    catch (error) { fs.renameSync(destinationCovers, stagedCovers); throw error; }
  } finally {
    // staging is a newly created child of the selected destination, never the selected folder itself.
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

async function initializeStorageState(configPath, defaultRoot) {
  let config = {};
  if (fs.existsSync(configPath)) config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const configured = config.path;
  // Configurações antigas podiam guardar a pasta escolhida (pai de Bi-Bip).
  // Só tratamos como mídia removida quando ela já aponta para a biblioteca.
  if (configured && path.basename(path.resolve(configured)).toLowerCase() === "bi-bip" && !fs.existsSync(configured)) {
    const fallback = storageDirectory(defaultRoot);
    fs.mkdirSync(fallback, { recursive: true });
    saveStoragePath(configPath, fallback, configured);
    return { root: fallback, unavailablePath: configured };
  }
  const source = configured || defaultRoot;
  const destination = storageDirectory(source);
  if (path.resolve(source) !== destination) {
    if (fs.existsSync(path.join(source, "biblioteca.db"))) await copyLibrary(source, destination);
    else fs.mkdirSync(destination, { recursive: true });
    saveStoragePath(configPath, destination);
  }
  return { root: destination, unavailablePath: config.unavailablePath || null };
}

async function initializeStorage(configPath, defaultRoot) {
  return (await initializeStorageState(configPath, defaultRoot)).root;
}

module.exports = { storageDirectory, saveStoragePath, copyLibrary, initializeStorage, initializeStorageState };
