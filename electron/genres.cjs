const DEFAULT_GENRES = ["Romance", "Realismo Mágico", "Mistério", "Suspense", "Ficção", "Fantasia", "Ficção Clássica", "Poesia", "Biografia", "História", "Ciência", "Drama", "Infantil", "Autoajuda", "Religião", "Quadrinhos", "Terror", "Aventura", "Outros"];
const genreKey = name => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();

function createGenresApi(db) {
  const getAll = () => {
    const names = new Map();
    for (const name of [...DEFAULT_GENRES, ...db.prepare("SELECT name FROM genres ORDER BY name COLLATE NOCASE").all().map(row => row.name), ...db.prepare("SELECT DISTINCT genre FROM books WHERE trim(coalesce(genre,''))!='' ORDER BY genre COLLATE NOCASE").all().map(row => row.genre)]) {
      const clean = name.trim().replace(/\s+/g, " ");
      const key = genreKey(clean);
      if (key && key !== "todos" && !names.has(key)) names.set(key, clean);
    }
    return [...names.values()];
  };
  return {
    getAll,
    add(name) {
      if (typeof name !== "string") throw new Error("Informe o nome do gênero.");
      const clean = name.trim().replace(/\s+/g, " ");
      if (!clean || clean.length > 80 || /[\x00-\x1f\x7f]/.test(clean)) throw new Error("O gênero deve ter entre 1 e 80 caracteres.");
      const key = genreKey(clean);
      if (key === "todos") throw new Error('Escolha outro nome: "Todos" é reservado para o filtro do catálogo.');
      const existing = getAll().find(item => genreKey(item) === key);
      const canonical = existing || clean;
      if (!DEFAULT_GENRES.some(item => genreKey(item) === key)) db.prepare("INSERT OR IGNORE INTO genres(key,name) VALUES (?,?)").run(key, canonical);
      return canonical;
    },
  };
}

module.exports = { DEFAULT_GENRES, genreKey, createGenresApi };
