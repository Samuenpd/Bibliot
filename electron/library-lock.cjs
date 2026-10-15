const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

function readLock(lockPath) {
  try { return JSON.parse(fs.readFileSync(lockPath, "utf8")); } catch { return null; }
}

function acquireLibraryLock(storageRoot) {
  const lockPath = path.join(storageRoot, ".bibip-library.lock");
  const token = crypto.randomUUID();
  const details = { token, hostname: os.hostname(), pid: process.pid, startedAt: new Date().toISOString() };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = fs.openSync(lockPath, "wx", 0o600);
      fs.writeFileSync(handle, JSON.stringify(details, null, 2));
      let released = false;
      return () => {
        if (released) return;
        released = true;
        try { fs.closeSync(handle); } catch {}
        try {
          if (readLock(lockPath)?.token === token) fs.rmSync(lockPath, { force: true });
        } catch {}
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existing = readLock(lockPath);
      // A crashed process on this computer cannot keep the library locked forever.
      if (attempt === 0 && existing?.hostname === os.hostname() && Number.isInteger(existing.pid)) {
        try { process.kill(existing.pid, 0); }
        catch (processError) {
          if (processError?.code === "ESRCH") { fs.rmSync(lockPath, { force: true }); continue; }
        }
      }
      const computer = existing?.hostname ? ` no computador ${existing.hostname}` : "";
      throw new Error(`Esta biblioteca já está aberta${computer}. Feche o Bi-Bip antes de usá-la neste computador. Se ele foi fechado de forma inesperada, confirme que ninguém está usando a biblioteca e abra-a novamente.`);
    }
  }
}

module.exports = { acquireLibraryLock };
