const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");
const { pathToFileURL } = require("url");

const root = path.join(__dirname, "..");
const source = path.join(root, "src", "assets", "brand", "bibip-icon.svg");
const output = path.join(root, "build", "icons");
const sizes = [16, 24, 32, 48, 64, 128, 256, 512];

function createIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = Buffer.alloc(images.length * 16);
  let offset = header.length + entries.length;
  images.forEach(({ size, data }, index) => {
    const entry = index * 16;
    entries.writeUInt8(size === 256 ? 0 : size, entry);
    entries.writeUInt8(size === 256 ? 0 : size, entry + 1);
    entries.writeUInt8(0, entry + 2);
    entries.writeUInt8(0, entry + 3);
    entries.writeUInt16LE(1, entry + 4);
    entries.writeUInt16LE(32, entry + 6);
    entries.writeUInt32LE(data.length, entry + 8);
    entries.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, entries, ...images.map(({ data }) => data)]);
}

app.whenReady().then(async () => {
  fs.mkdirSync(output, { recursive: true });
  const renderer = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, useContentSize: true });
  await renderer.loadURL(pathToFileURL(source).toString());
  const master = await renderer.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  renderer.destroy();
  if (master.isEmpty()) throw new Error(`Não foi possível renderizar ${source}`);
  const rendered = sizes.map((size) => ({
    size,
    data: master.resize({ width: size, height: size, quality: "best" }).toPNG(),
  }));
  rendered.forEach(({ size, data }) => fs.writeFileSync(path.join(output, `icon-${size}.png`), data));
  fs.writeFileSync(path.join(output, "icon.png"), rendered.find(({ size }) => size === 512).data);
  fs.writeFileSync(path.join(output, "icon.ico"), createIco(rendered.filter(({ size }) => size <= 256)));
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
