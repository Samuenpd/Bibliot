import { useState, useMemo, useEffect, useCallback } from "react"; //sammy
import {
  Search, BookOpen, Star, Heart, ChevronRight, Filter, X,
  BookMarked, Plus, Upload, Pencil, CheckCheck, Menu, SlidersHorizontal,
  Tag, Trash2, AlertCircle, CheckCircle2, Info,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

type TagDef = { id: number; name: string; color: string };

type Book = {
  id: number; title: string; author: string; genre: string;
  year: number; rating: number; pages: number; cover: string;
  description: string; featured: boolean; tagIds: number[];
  isRead?: boolean; isFavorite?: boolean;
};

type View = "catalog" | "add" | "edit" | "tags";
type ReadFilter = "todos" | "lidos" | "nao-lidos";
type ToastData = { message: string; type: "success" | "error" | "info" };

// ── Constants ──────────────────────────────────────────────────────────────

const TAG_COLORS = [
  { label: "Rosa", value: "#e8a0a8" },
  { label: "Vermelho", value: "#c0152a" },
  { label: "Laranja", value: "#d97148" },
  { label: "Amarelo", value: "#c9a84c" },
  { label: "Verde", value: "#6a9e72" },
  { label: "Azul", value: "#5b8db8" },
  { label: "Roxo", value: "#8b6bb1" },
  { label: "Marrom", value: "#8c6a58" },
];

const GENRES = ["Todos", "Romance", "Realismo Mágico", "Mistério", "Ficção", "Fantasia", "Ficção Clássica", "Poesia", "Biografia", "Outros"];

const EMPTY_FORM = {
  title: "", author: "", genre: "Romance",
  year: "", rating: "", pages: "",
  cover: "", description: "", featured: false, tagIds: [] as number[],
};

// ── Small components ────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-widest" style={{ fontFamily: "'DM Mono', monospace" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function TagChip({ tag, onRemove, small }: { tag: TagDef; onRemove?: () => void; small?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-semibold ${small ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2.5 py-1"}`}
      style={{ backgroundColor: tag.color + "22", color: tag.color, border: `1px solid ${tag.color}44` }}
    >
      {tag.name}
      {onRemove && (
        <button onClick={onRemove} className="hover:opacity-70 transition-opacity ml-0.5">
          <X size={small ? 8 : 10} />
        </button>
      )}
    </span>
  );
}

const inputCls = "w-full bg-background border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all";

// ── Toast component ─────────────────────────────────────────────────────────

function Toast({ toast, onClose }: { toast: ToastData; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const iconMap = {
    success: <CheckCircle2 size={18} className="shrink-0" />,
    error: <AlertCircle size={18} className="shrink-0" />,
    info: <Info size={18} className="shrink-0" />,
  };

  const colorMap = {
    success: "border-green-500 bg-green-50 text-green-800",
    error: "border-destructive bg-destructive/10 text-destructive",
    info: "border-primary bg-primary/10 text-primary",
  };

  return (
    <div
      className={`fixed bottom-6 right-6 z-[100] flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg backdrop-blur-sm ${colorMap[toast.type]}`}
      style={{ fontFamily: "'Nunito', sans-serif", animation: "slideUp 0.3s ease-out" }}
    >
      {iconMap[toast.type]}
      <span className="text-sm font-semibold">{toast.message}</span>
      <button onClick={onClose} className="ml-2 opacity-60 hover:opacity-100 transition-opacity">
        <X size={14} />
      </button>
    </div>
  );
}

// ── ConfirmDialog component ─────────────────────────────────────────────────

function ConfirmDialog({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" onClick={onCancel}>
      <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" />
      <div className="relative bg-card border border-border rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
            <AlertCircle size={20} className="text-destructive" />
          </div>
          <p className="text-sm font-semibold text-foreground leading-relaxed">{message}</p>
        </div>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="px-4 py-2 rounded-xl text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-accent transition-all">
            Cancelar
          </button>
          <button onClick={onConfirm} className="px-4 py-2 rounded-xl text-sm font-semibold bg-destructive text-white hover:bg-destructive/90 transition-all">
            Excluir
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sidebar content ─────────────────────────────────────────────────────────

function SidebarContent({
  search, setSearch, readFilter, setReadFilter,
  selectedGenre, setSelectedGenre, selectedTagId, setSelectedTagId,
  books, readBooks, favorites, tags, onClose,
}: {
  search: string; setSearch: (v: string) => void;
  readFilter: ReadFilter; setReadFilter: (v: ReadFilter) => void;
  selectedGenre: string; setSelectedGenre: (v: string) => void;
  selectedTagId: number | null; setSelectedTagId: (v: number | null) => void;
  books: Book[]; readBooks: number[]; favorites: number[];
  tags: TagDef[]; onClose?: () => void;
}) {
  return (
    <div className="flex flex-col gap-5 h-full overflow-y-auto p-5">
      <div>
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2 block" style={{ fontFamily: "'DM Mono', monospace" }}>Pesquisar</label>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Título ou autor..."
            className="w-full bg-card border border-border rounded-lg pl-9 pr-8 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all" />
          {search && <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X size={13} /></button>}
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2 block" style={{ fontFamily: "'DM Mono', monospace" }}>Leitura</label>
        <div className="flex flex-col gap-1">
          {([{ key: "todos", label: "Todos" }, { key: "lidos", label: "Lidos" }, { key: "nao-lidos", label: "Não lidos" }] as { key: ReadFilter; label: string }[]).map(({ key, label }) => (
            <button key={key} onClick={() => { setReadFilter(key); onClose?.(); }}
              className={`text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center justify-between ${readFilter === key ? "bg-primary text-primary-foreground font-semibold" : "text-foreground hover:bg-accent"}`}>
              <span>{label}</span>
              {readFilter === key && <ChevronRight size={13} />}
            </button>
          ))}
        </div>
      </div>

      {tags.length > 0 && (
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2 block" style={{ fontFamily: "'DM Mono', monospace" }}>Tags</label>
          <div className="flex flex-col gap-1">
            <button onClick={() => { setSelectedTagId(null); onClose?.(); }}
              className={`text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center justify-between ${selectedTagId === null ? "bg-primary text-primary-foreground font-semibold" : "text-foreground hover:bg-accent"}`}>
              <span>Todas as tags</span>
              {selectedTagId === null && <ChevronRight size={13} />}
            </button>
            {tags.map((tag) => (
              <button key={tag.id} onClick={() => { setSelectedTagId(tag.id === selectedTagId ? null : tag.id); onClose?.(); }}
                className={`text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center justify-between ${selectedTagId === tag.id ? "font-semibold" : "text-foreground hover:bg-accent"}`}
                style={selectedTagId === tag.id ? { backgroundColor: tag.color + "22", color: tag.color } : {}}>
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                  {tag.name}
                </span>
                <span className="text-xs opacity-60">{books.filter((b) => b.tagIds.includes(tag.id)).length}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2 block" style={{ fontFamily: "'DM Mono', monospace" }}>Gênero</label>
        <div className="flex flex-col gap-1">
          {GENRES.map((g) => (
            <button key={g} onClick={() => { setSelectedGenre(g); onClose?.(); }}
              className={`text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center justify-between ${selectedGenre === g ? "bg-primary text-primary-foreground font-semibold" : "text-foreground hover:bg-accent"}`}>
              <span>{g}</span>
              {selectedGenre === g && <ChevronRight size={13} />}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-auto border-t border-sidebar-border pt-4 space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest" style={{ fontFamily: "'DM Mono', monospace" }}>Acervo</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Títulos", val: books.length },
            { label: "Lidos", val: readBooks.length },
            { label: "Favoritos", val: favorites.length },
            { label: "Tags", val: tags.length },
          ].map(({ label, val }) => (
            <div key={label} className="bg-card rounded-lg p-2.5 flex flex-col items-center gap-0.5">
              <span className="text-lg font-bold text-foreground leading-none">{val}</span>
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Book form ───────────────────────────────────────────────────────────────

function BookForm({ initial, onSubmit, onCancel, isEdit, tags, onToast }: {
  initial: typeof EMPTY_FORM;
  onSubmit: (data: typeof EMPTY_FORM) => void;
  onCancel: () => void;
  isEdit: boolean;
  tags: TagDef[];
  onToast: (msg: string, type: ToastData["type"]) => void;
}) {
  const [form, setForm] = useState({ ...initial });
  const [saved, setSaved] = useState(false);
  const [isbn, setIsbn] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  const set = (field: keyof typeof EMPTY_FORM) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const val = e.target.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value;
      setForm((f) => ({ ...f, [field]: val }));
    };

  const toggleTag = (id: number) =>
    setForm((f) => ({ ...f, tagIds: f.tagIds.includes(id) ? f.tagIds.filter((x) => x !== id) : [...f.tagIds, id] }));

  // Mapa de gêneros amplo (Google Books)
  const mapGenre = (categories: string[] | undefined): string => {
    if (!categories || categories.length === 0) return "";
    const cat = categories[0].toLowerCase();

    if (/romance|romantic|love|relationships|erotic|chick-lit/.test(cat)) return "Romance";
    if (/ficção|fiction|novel|literary|general fiction|short stories/.test(cat)) return "Ficção";
    if (/fantasia|fantasy|magic|wizards|dragons/.test(cat)) return "Fantasia";
    if (/thriller|suspense|mystery|crime|detective|horror/.test(cat)) return "Suspense";
    if (/biografia|biography|autobiography|memoir/.test(cat)) return "Biografia";
    if (/history|história|historical/.test(cat)) return "História";
    if (/science|ciência|physics|technology|technology/.test(cat)) return "Ciência";
    if (/poesia|poetry|poems/.test(cat)) return "Poesia";
    if (/drama|teatro|plays/.test(cat)) return "Drama";
    if (/juvenile|young adult|ya|children|infantil/.test(cat)) return "Infantil";
    return "Outros";
  };

  // Inferência de gênero por título/sinopse quando a API não devolver categorias
  const inferGenreFromText = (title: string, description: string): string => {
    const text = `${title} ${description}`.toLowerCase();

    if (/romance|amor|apaixonar|relacionamento|namoro/.test(text)) return "Romance";
    if (/fantasia|magia|reino|bruxo|dragão/.test(text)) return "Fantasia";
    if (/assassino|crime|investigação|suspense|mistério/.test(text)) return "Suspense";
    if (/biografia|memórias|autobiografia/.test(text)) return "Biografia";

    if (description && description.trim().length > 40) return "Ficção";

    return "Outros";
  };

  // Extrai capa com zoom hack (melhor resolução) e limpeza de URL
  const extractBestCover = (imageLinks: Record<string, string> | undefined): string => {
    if (!imageLinks) return "";
    const priority = ["extraLarge", "large", "medium", "smallThumbnail", "thumbnail"];
    for (const key of priority) {
      if (imageLinks[key]) {
        return imageLinks[key]
          .replace(/^http:/, "https:")
          .replace(/&edge=curl/g, "")
          .replace(/zoom=\d+/, "zoom=3");
      }
    }
    return "";
  };

  // Helper: percorre itens do Google Books e retorna o primeiro volume com capa
  const findVolumeWithCover = async (isbnQuery: string): Promise<Record<string, any> | undefined> => {
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(isbnQuery)}&maxResults=8`;
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const data = await res.json();
    const items = data?.items || [];
    for (const it of items) {
      const v = it?.volumeInfo;
      const hasCover = v?.imageLinks?.thumbnail || v?.imageLinks?.smallThumbnail;
      if (hasCover) return v;
    }
    return items[0]?.volumeInfo;
  };

  // Mesclagem Progressiva de Dados com busca em cascata + gênero + capa multifocal
  const handleSearchISBN = async () => {
    const normalizedIsbn = isbn.trim().replace(/-/g, "");

    if (!normalizedIsbn) {
      onToast("Informe um ISBN para buscar os dados no Bi-Bip Biblioteca Privada.", "info");
      setIsSearching(false);
      return;
    }

    try {
      setIsSearching(true);

      const acc: { title: string; author: string; year: string; pages: string; cover: string; description: string; genre: string } = {
        title: "",
        author: "",
        year: "",
        pages: "",
        cover: "",
        description: "",
        genre: "",
      };

      // ── ETAPA 1: BrasilAPI ──
      try {
        const brResponse = await fetch(`https://brasilapi.com.br/api/isbn/v1/${normalizedIsbn}`);
        if (brResponse.ok) {
          const brData = await brResponse.json();
          if (brData && brData.title) {
            acc.title = brData.title || "";
            acc.author = Array.isArray(brData.authors)
              ? brData.authors.filter(Boolean).join(", ")
              : (brData.authors || "");
            acc.year = brData.year
              ? String(brData.year)
              : (typeof brData.published_date === "string"
                  ? (brData.published_date.match(/\d{4}/)?.[0] || "")
                  : "");
            acc.pages = brData.page_count ? String(brData.page_count) : "";
            acc.cover = brData.cover_url || brData.image || "";
            acc.description = brData.synopsis || brData.description || "";
          }
        }
      } catch {
        // Falha silenciosa
      }

      // ── ETAPA 2: Google Books multifocal por ISBN ──
      const needGoogle = !acc.cover || !acc.description || !acc.author || !acc.year || !acc.pages || !acc.title || !acc.genre;

      if (needGoogle) {
        try {
          const volume = await findVolumeWithCover(`isbn:${normalizedIsbn}`);
          if (volume) {
            // Preencher lacunas com primeiro item válido encontrado
            if (!acc.title && volume.title) acc.title = volume.title;
            if (!acc.author && Array.isArray(volume.authors)) acc.author = volume.authors.filter(Boolean).join(", ");
            if (!acc.year && typeof volume.publishedDate === "string") {
              const m = volume.publishedDate.match(/\d{4}/);
              if (m) acc.year = m[0];
            }
            if (!acc.pages && volume.pageCount) acc.pages = String(volume.pageCount);
            if (!acc.cover && volume.imageLinks) acc.cover = extractBestCover(volume.imageLinks);
            if (!acc.description && volume.description) acc.description = volume.description;
            if (!acc.genre) acc.genre = mapGenre(volume.categories);
          }
        } catch {
          // Falha silenciosa
        }
      }

      // ── ETAPA 3: CAÇA À CAPA E GÊNERO POR TÍTULO ( multifocal ) ──
      if (acc.title && !acc.cover) {
        try {
          const volumeTitle = await findVolumeWithCover(`${acc.title} ${acc.author}`);
          if (volumeTitle) {
            if (!acc.cover && volumeTitle.imageLinks) acc.cover = extractBestCover(volumeTitle.imageLinks);
            if (!acc.genre) {
              acc.genre = mapGenre(volumeTitle.categories);
              if (!acc.genre) acc.genre = inferGenreFromText(acc.title, acc.description);
            }
          }
        } catch {
          // Falha silenciosa
        }
      } else if (!acc.genre) {
        acc.genre = inferGenreFromText(acc.title, acc.description);
      }

      // ── ETAPA 4: VALIDAÇÃO/CAÇA FINAL DE CAPA (Open Library direto + por título) ──
      if (!acc.cover) {
        // Primeiro, tenta por ISBN direto com default=false (evita placeholder transparente)
        try {
          const olCoverUrl = `https://covers.openlibrary.org/b/isbn/${normalizedIsbn}-L.jpg?default=false`;
          const coverRes = await fetch(olCoverUrl, { method: "GET" });
          if (coverRes.ok && coverRes.headers.get("content-type")?.startsWith("image/")) {
            acc.cover = olCoverUrl;
          }
        } catch {
          // silencioso
        }
      }

      // Se ainda não tiver capa, busca por título na Open Library
      if (!acc.cover && acc.title) {
        try {
          const searchRes = await fetch(
            `https://openlibrary.org/search.json?q=${encodeURIComponent(acc.title)}`
          );
          if (searchRes.ok) {
            const searchData = await searchRes.json();
            const coverId = searchData?.docs?.[0]?.cover_i;
            if (coverId) {
              acc.cover = `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`;
            }
          }
        } catch {
          // silencioso
        }
      }

      // Se mesmo assim não houver capa, deixa vazio para o formulário usar fallback padrão no backend (não altera DB aqui)
      if (!acc.cover) acc.cover = "";

      // Gênero padrão se vazio após inferência
      if (!acc.genre) acc.genre = "Outros";

      // Sinopse via Wikipedia (se ainda vazia E temos título)
      if (!acc.description && acc.title) {
        try {
          const searchRes = await fetch(
            `https://pt.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(acc.title + " livro")}&format=json&origin=*`
          );
          const searchData = await searchRes.json();
          const firstResult = searchData?.query?.search?.[0];
          if (firstResult?.title) {
            const extractRes = await fetch(
              `https://pt.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&titles=${encodeURIComponent(firstResult.title)}&format=json&origin=*`
            );
            const extractData = await extractRes.json();
            const pages = extractData?.query?.pages;
            if (pages) {
              const page = Object.values(pages)[0] as { extract?: string } | undefined;
              if (page?.extract) acc.description = page.extract;
            }
          }
        } catch {
          // Fallback silencioso
        }
      }

      // ── ATUALIZAR FORMULÁRIO E FEEDBACK ──
      if (acc.title) {
        setForm((prev) => ({
          ...prev,
          title: acc.title,
          author: acc.author || prev.author,
          year: acc.year || prev.year,
          pages: acc.pages || prev.pages,
          cover: acc.cover || prev.cover,
          description: acc.description || prev.description || "",
          genre: acc.genre || prev.genre,
        }));
        setIsbn("");
        onToast("Dados do livro carregados e combinados com sucesso no Bi-Bip!", "success");
      } else {
        setIsbn("");
        onToast("ISBN não encontrado nas bases de dados. Insira as informações manualmente.", "error");
      }
    } catch {
      setIsbn("");
      onToast("ISBN não encontrado nas bases de dados. Insira as informações manualmente.", "error");
    } finally {
      setIsSearching(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => { onSubmit(form); setSaved(false); }, 900);
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>
          {isEdit ? "Editar livro" : "Cadastrar novo livro"}
        </h1>
        <p className="text-sm text-muted-foreground">{isEdit ? "Altere os dados e salve." : "Preencha os dados para adicionar ao acervo."}</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4 sm:gap-5">
        <div className="flex gap-4 items-start">
          <div className="w-20 h-28 sm:w-24 sm:h-36 rounded-xl overflow-hidden bg-accent shrink-0 border border-border">
            {form.cover
              ? <img src={form.cover} alt="capa" className="w-full h-full object-cover" />
              : <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-muted-foreground"><Upload size={16} /><span className="text-xs text-center px-1">sem capa</span></div>
            }
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <Field label="ISBN">
                  <input
                    type="text"
                    placeholder="Ex: 9788575226930"
                    value={isbn}
                    onChange={(e) => setIsbn(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleSearchISBN();
                      }
                    }}
                    className={inputCls}
                  />
                </Field>
              </div>
              <button
                type="button"
                onClick={handleSearchISBN}
                disabled={isSearching}
                className={`px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${isSearching ? "bg-muted text-muted-foreground cursor-not-allowed" : "bg-primary text-primary-foreground hover:bg-destructive"}`}
              >
                {isSearching ? "Buscando..." : "Buscar"}
              </button>
            </div>

            <div className="mt-4">
              <Field label="URL da capa">
                <input type="text" placeholder="https://..." value={form.cover} onChange={set("cover")} className={inputCls} />
              </Field>
              <p className="text-xs text-muted-foreground mt-1.5">Se vazio, capa padrão será usada.</p>
            </div>
          </div>
        </div>

        <Field label="Título *">
          <input required type="text" placeholder="Nome do livro" value={form.title} onChange={set("title")} className={inputCls} />
        </Field>

        <Field label="Autor *">
          <input required type="text" placeholder="Nome do autor" value={form.author} onChange={set("author")} className={inputCls} />
        </Field>

        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <Field label="Gênero *">
            <select required value={form.genre} onChange={set("genre")} className={inputCls}>
              {GENRES.filter((g) => g !== "Todos").map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </Field>
          <Field label="Ano">
            <input type="number" min={0} max={new Date().getFullYear()} value={form.year || ""} onChange={set("year")} className={inputCls} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <Field label="Páginas">
            <input type="number" min={1} placeholder="ex: 320" value={form.pages || ""} onChange={set("pages")} className={inputCls} />
          </Field>
          <Field label="Avaliação (0–5)">
            <input type="number" min={0} max={5} step={0.1} value={form.rating || ""} onChange={set("rating")} className={inputCls} />
          </Field>
        </div>

        <Field label="Sinopse">
          <textarea rows={3} placeholder="Breve descrição..." value={form.description} onChange={set("description")} className={inputCls + " resize-none"} />
        </Field>

        {tags.length > 0 && (
          <Field label="Tags">
            <div className="flex flex-wrap gap-2 pt-1">
              {tags.map((tag) => {
                const active = form.tagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    className="inline-flex items-center gap-1.5 rounded-full text-xs px-3 py-1.5 font-semibold border transition-all"
                    style={active
                      ? { backgroundColor: tag.color, color: "#fff", borderColor: tag.color }
                      : { backgroundColor: tag.color + "18", color: tag.color, borderColor: tag.color + "44" }
                    }
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
                    {tag.name}
                    {active && <CheckCheck size={11} />}
                  </button>
                );
              })}
            </div>
          </Field>
        )}

        <label className="flex items-center gap-3 cursor-pointer select-none">
          <div
            onClick={() => setForm((f) => ({ ...f, featured: !f.featured }))}
            className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ${form.featured ? "bg-primary" : "bg-switch-background"}`}
          >
            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.featured ? "translate-x-5" : "translate-x-0.5"}`} />
          </div>
          <div>
            <span className="text-sm font-semibold text-foreground">Marcar como destaque</span>
            <p className="text-xs text-muted-foreground">Aparece no banner principal</p>
          </div>
        </label>

        <div className="flex gap-3 pt-2">
          <button
            type="submit" disabled={saved}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all ${saved ? "bg-green-100 text-green-700 border border-green-200" : "bg-primary text-primary-foreground hover:bg-destructive"}`}
          >
            {saved
              ? <><CheckCheck size={15} /> {isEdit ? "Salvo!" : "Cadastrado!"}</>
              : <>{isEdit ? <Pencil size={15} /> : <Plus size={15} />} {isEdit ? "Salvar alterações" : "Adicionar ao acervo"}</>
            }
          </button>
          <button type="button" onClick={onCancel} className="px-4 sm:px-5 py-3 rounded-xl text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-accent transition-all">
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Tags management page ────────────────────────────────────────────────────

function TagsPage({ tags, books, onReload }: { tags: TagDef[]; books: Book[]; onReload: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(TAG_COLORS[0].value);
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");

  const usageCount = (id: number) => books.filter((b) => b.tagIds.includes(id)).length;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await window.api.tags.add({ name: name.trim(), color });
    await onReload();
    setName("");
    setColor(TAG_COLORS[0].value);
  };

  const startEdit = (tag: TagDef) => { setEditId(tag.id); setEditName(tag.name); setEditColor(tag.color); };

  const saveEdit = async () => {
    if (!editName.trim() || editId === null) return;
    await window.api.tags.update(editId, { name: editName.trim(), color: editColor });
    await onReload();
    setEditId(null);
  };

  const deleteTag = async (id: number) => {
    await window.api.tags.delete(id);
    await onReload();
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>
          Gerenciar tags
        </h1>
        <p className="text-sm text-muted-foreground">Crie e organize tags para classificar seus livros.</p>
      </div>

      <div className="bg-card border border-border rounded-2xl p-4 sm:p-5 mb-6">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4" style={{ fontFamily: "'DM Mono', monospace" }}>
          Nova tag
        </p>
        <form onSubmit={handleCreate} className="flex flex-col gap-4">
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <Field label="Nome">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Para reler, Emprestado..."
                  className={inputCls}
                  maxLength={30}
                />
              </Field>
            </div>
            <button
              type="submit"
              disabled={!name.trim()}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-destructive transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              <Plus size={15} /> Criar
            </button>
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2 block" style={{ fontFamily: "'DM Mono', monospace" }}>
              Cor
            </label>
            <div className="flex flex-wrap gap-2">
              {TAG_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  title={c.label}
                  onClick={() => setColor(c.value)}
                  className="w-7 h-7 rounded-full border-2 transition-all hover:scale-110"
                  style={{ backgroundColor: c.value, borderColor: color === c.value ? "#2d1a0e" : "transparent", boxShadow: color === c.value ? "0 0 0 2px white inset" : "none" }}
                />
              ))}
              <label className="w-7 h-7 rounded-full border-2 border-dashed border-border flex items-center justify-center cursor-pointer hover:scale-110 transition-all overflow-hidden" title="Cor personalizada">
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="opacity-0 absolute w-px h-px" />
                <span className="w-4 h-4 rounded-full" style={{ backgroundColor: color }} />
              </label>
            </div>
          </div>

          {name && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Prévia:</span>
              <TagChip tag={{ id: 0, name, color }} />
            </div>
          )}
        </form>
      </div>

      {tags.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Tag size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-base font-medium">Nenhuma tag criada ainda</p>
          <p className="text-sm mt-1">Use o formulário acima para criar sua primeira tag.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2" style={{ fontFamily: "'DM Mono', monospace" }}>
            Tags existentes ({tags.length})
          </p>
          {tags.map((tag) => (
            <div key={tag.id} className="bg-card border border-border rounded-xl p-3 sm:p-4">
              {editId === tag.id ? (
                <div className="flex flex-col gap-3">
                  <div className="flex gap-2 items-center">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className={inputCls + " py-2"}
                      maxLength={30}
                      autoFocus
                    />
                    <button onClick={saveEdit} className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-destructive transition-all shrink-0">
                      Salvar
                    </button>
                    <button onClick={() => setEditId(null)} className="px-3 py-2 rounded-lg bg-accent text-foreground text-sm font-semibold hover:bg-secondary transition-all shrink-0">
                      <X size={14} />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {TAG_COLORS.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => setEditColor(c.value)}
                        className="w-6 h-6 rounded-full border-2 transition-all hover:scale-110"
                        style={{ backgroundColor: c.value, borderColor: editColor === c.value ? "#2d1a0e" : "transparent", boxShadow: editColor === c.value ? "0 0 0 2px white inset" : "none" }}
                      />
                    ))}
                    <label className="w-6 h-6 rounded-full border-2 border-dashed border-border flex items-center justify-center cursor-pointer overflow-hidden">
                      <input type="color" value={editColor} onChange={(e) => setEditColor(e.target.value)} className="opacity-0 absolute w-px h-px" />
                      <span className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: editColor }} />
                    </label>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <TagChip tag={tag} />
                    <span className="text-xs text-muted-foreground shrink-0" style={{ fontFamily: "'DM Mono', monospace" }}>
                      {usageCount(tag.id)} {usageCount(tag.id) === 1 ? "livro" : "livros"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => startEdit(tag)} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => deleteTag(tag.id)} className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main App ────────────────────────────────────────────────────────────────

export default function App() {
  const [books, setBooks] = useState<Book[]>([]);
  const [tags, setTags] = useState<TagDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedGenre, setSelectedGenre] = useState("Todos");
  const [selectedTagId, setSelectedTagId] = useState<number | null>(null);
  const [readFilter, setReadFilter] = useState<ReadFilter>("todos");
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [view, setView] = useState<View>("catalog");
  const [editingBook, setEditingBook] = useState<Book | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Toast state
  const [toast, setToast] = useState<ToastData | null>(null);
  const showToast = useCallback((message: string, type: ToastData["type"]) => {
    setToast({ message, type });
  }, []);

  // Confirm delete dialog state
  const [confirmDelete, setConfirmDelete] = useState<Book | null>(null);

  const favorites = useMemo(() => books.filter((b) => b.isFavorite).map((b) => b.id), [books]);
  const readBooks = useMemo(() => books.filter((b) => b.isRead).map((b) => b.id), [books]);

  const reloadBooks = async () => setBooks(await window.api.books.getAll());
  const reloadTags = async () => setTags(await window.api.tags.getAll());

  useEffect(() => {
    (async () => {
      await Promise.all([reloadBooks(), reloadTags()]);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    return books.filter((b) => {
      const matchesSearch = search === "" || b.title.toLowerCase().includes(search.toLowerCase()) || b.author.toLowerCase().includes(search.toLowerCase());
      const matchesGenre = selectedGenre === "Todos" || b.genre === selectedGenre;
      const matchesRead = readFilter === "todos" || (readFilter === "lidos" && readBooks.includes(b.id)) || (readFilter === "nao-lidos" && !readBooks.includes(b.id));
      const matchesTag = selectedTagId === null || b.tagIds.includes(selectedTagId);
      return matchesSearch && matchesGenre && matchesRead && matchesTag;
    });
  }, [search, selectedGenre, readFilter, selectedTagId, readBooks, books]);

  const featured = books.filter((b) => b.featured);

  const toggleFav = async (id: number) => {
    setBooks((prev) => prev.map((b) => b.id === id ? { ...b, isFavorite: !b.isFavorite } : b));
    await window.api.books.toggleFavorite(id);
  };

  const toggleRead = async (id: number) => {
    setBooks((prev) => prev.map((b) => b.id === id ? { ...b, isRead: !b.isRead } : b));
    await window.api.books.toggleRead(id);
  };

  const handleAdd = async (data: typeof EMPTY_FORM) => {
    await window.api.books.add({
      ...data,
      cover: data.cover || "https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=300&h=420&fit=crop&auto=format",
    });
    await reloadBooks();
    setView("catalog");
    showToast("Livro cadastrado com sucesso no Bi-Bip!", "success");
  };

  const handleEdit = async (data: typeof EMPTY_FORM) => {
    if (!editingBook) return;
    await window.api.books.update(editingBook.id, { ...data, cover: data.cover || editingBook.cover });
    await reloadBooks();
    setEditingBook(null);
    setView("catalog");
    showToast("Livro atualizado com sucesso no Bi-Bip!", "success");
  };

  const handleDelete = async (id: number) => {
    await window.api.books.delete(id);
    setSelectedBook(null);
    setConfirmDelete(null);
    await reloadBooks();
    showToast("Livro removido do acervo do Bi-Bip.", "info");
  };

  const openEdit = (book: Book) => { setEditingBook(book); setSelectedBook(null); setView("edit"); };

  const sidebarProps = { search, setSearch, readFilter, setReadFilter, selectedGenre, setSelectedGenre, selectedTagId, setSelectedTagId, books, readBooks, favorites, tags };

  const navBtn = (v: View, icon: React.ReactNode, label: string) => (
    <button
      onClick={() => { setView(v); setEditingBook(null); }}
      className={`flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all ${view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center" style={{ fontFamily: "'Nunito', sans-serif" }}>
        <p className="text-sm text-muted-foreground">Carregando biblioteca...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col" style={{ fontFamily: "'Nunito', sans-serif" }}>
      {/* Header */}
      <header className="bg-card border-b border-border px-4 sm:px-6 py-3 flex items-center justify-between z-20 sticky top-0">
        <div className="flex items-center gap-2 sm:gap-3">
          {view === "catalog" && (
            <button onClick={() => setDrawerOpen(true)} className="md:hidden p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-accent transition-colors" aria-label="Filtros">
              <Menu size={20} />
            </button>
          )}
          <BookMarked size={18} className="text-primary hidden md:block" />
          <span className="text-xl sm:text-2xl font-bold tracking-tight select-none" style={{ fontFamily: "'Playfair Display', serif", color: "#c0152a", letterSpacing: "-0.02em" }}>
            Bi-Bip
          </span>
          <span className="text-xs text-muted-foreground mt-1 hidden sm:block" style={{ fontFamily: "'DM Mono', monospace" }}>biblioteca privada</span>
        </div>

        <nav className="flex items-center gap-1">
          {navBtn("catalog", <BookOpen size={14} />, "Catálogo")}
          {navBtn("add", <Plus size={14} />, "Cadastrar")}
          {navBtn("tags", <Tag size={14} />, "Tags")}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <CheckCheck size={13} className={readBooks.length > 0 ? "text-primary" : ""} />
            <span className="hidden sm:inline">{readBooks.length} lidos</span>
            <span className="sm:hidden">{readBooks.length}</span>
          </span>
          <span className="flex items-center gap-1">
            <Heart size={13} className={favorites.length > 0 ? "text-primary fill-primary" : ""} />
            <span className="hidden sm:inline">{favorites.length} favoritos</span>
            <span className="sm:hidden">{favorites.length}</span>
          </span>
        </div>
      </header>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-72 bg-sidebar shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-sidebar-border shrink-0">
              <div className="flex items-center gap-2">
                <SlidersHorizontal size={15} className="text-primary" />
                <span className="text-sm font-bold text-foreground">Filtros</span>
              </div>
              <button onClick={() => setDrawerOpen(false)} className="text-muted-foreground hover:text-foreground p-1"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <SidebarContent {...sidebarProps} onClose={() => setDrawerOpen(false)} />
            </div>
          </aside>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Desktop sidebar */}
        {view === "catalog" && (
          <aside className="hidden md:flex w-64 shrink-0 bg-sidebar border-r border-sidebar-border flex-col">
            <SidebarContent {...sidebarProps} />
          </aside>
        )}

        <main className="flex-1 overflow-y-auto">
          {/* ── Catalog ── */}
          {view === "catalog" && (
            <div className="px-4 sm:px-6 py-4 sm:py-6">
              {(selectedGenre !== "Todos" || readFilter !== "todos" || search || selectedTagId !== null) && (
                <div className="md:hidden flex flex-wrap gap-2 mb-4">
                  {search && <span className="flex items-center gap-1 bg-primary/10 text-primary text-xs px-2.5 py-1 rounded-full font-medium">"{search}"<button onClick={() => setSearch("")}><X size={10} /></button></span>}
                  {selectedGenre !== "Todos" && <span className="flex items-center gap-1 bg-primary/10 text-primary text-xs px-2.5 py-1 rounded-full font-medium">{selectedGenre}<button onClick={() => setSelectedGenre("Todos")}><X size={10} /></button></span>}
                  {readFilter !== "todos" && <span className="flex items-center gap-1 bg-primary/10 text-primary text-xs px-2.5 py-1 rounded-full font-medium">{readFilter === "lidos" ? "Lidos" : "Não lidos"}<button onClick={() => setReadFilter("todos")}><X size={10} /></button></span>}
                  {selectedTagId !== null && (() => { const t = tags.find((t) => t.id === selectedTagId); return t ? <TagChip tag={t} onRemove={() => setSelectedTagId(null)} /> : null; })()}
                </div>
              )}

              {search === "" && selectedGenre === "Todos" && readFilter === "todos" && selectedTagId === null && (
                <section className="mb-6 sm:mb-8">
                  <div className="flex items-center gap-2 mb-3">
                    <Star size={14} className="text-primary fill-primary" />
                    <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest" style={{ fontFamily: "'DM Mono', monospace" }}>Destaques</h2>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                    {featured.map((book) => (
                      <div key={book.id} onClick={() => setSelectedBook(book)} className="relative rounded-2xl overflow-hidden h-40 sm:h-52 group cursor-pointer">
                        <img src={book.cover} alt={book.title} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                        <div className="absolute bottom-0 left-0 right-0 p-3 sm:p-4 text-white">
                          <p className="text-xs opacity-80 mb-0.5">{book.author}</p>
                          <h3 className="text-base sm:text-lg font-bold leading-tight" style={{ fontFamily: "'Playfair Display', serif" }}>{book.title}</h3>
                        </div>
                        {readBooks.includes(book.id) && (
                          <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/50 text-white text-xs px-2 py-0.5 rounded-full">
                            <CheckCheck size={10} /> Lido
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <div>
                <div className="flex items-center justify-between mb-3 sm:mb-4">
                  <div className="flex items-center gap-2">
                    <Filter size={13} className="text-muted-foreground" />
                    <span className="text-xs sm:text-sm text-muted-foreground">{filtered.length} {filtered.length === 1 ? "resultado" : "resultados"}</span>
                  </div>
                  <button onClick={() => setDrawerOpen(true)} className="md:hidden flex items-center gap-1.5 text-xs font-semibold text-primary border border-primary/30 px-3 py-1.5 rounded-lg hover:bg-primary/10 transition-colors">
                    <SlidersHorizontal size={12} /> Filtrar
                  </button>
                </div>

                {filtered.length === 0 ? (
                  <div className="text-center py-16 text-muted-foreground">
                    <BookOpen size={36} className="mx-auto mb-3 opacity-30" />
                    <p className="text-base font-medium">Nenhum livro encontrado</p>
                    <p className="text-sm mt-1">Tente outro termo ou filtro</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
                    {filtered.map((book) => {
                      const isRead = readBooks.includes(book.id);
                      const isFav = favorites.includes(book.id);
                      const bookTags = tags.filter((t) => book.tagIds.includes(t.id));
                      return (
                        <div key={book.id} onClick={() => setSelectedBook(book)} className="group text-left flex flex-col gap-2 cursor-pointer">
                          <div className="relative rounded-xl overflow-hidden bg-accent aspect-[3/4]">
                            <img src={book.cover} alt={book.title} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
                            {isRead && <div className="absolute inset-0 bg-primary/10" />}
                            <div
                              role="button" tabIndex={0}
                              onClick={(e) => { e.stopPropagation(); toggleFav(book.id); }}
                              onKeyDown={(e) => e.key === "Enter" && (e.stopPropagation(), toggleFav(book.id))}
                              className="absolute top-2 right-2 p-1.5 rounded-full bg-card/80 backdrop-blur-sm hover:scale-110 transition-transform"
                            >
                              <Heart size={12} className={isFav ? "text-primary fill-primary" : "text-muted-foreground"} />
                            </div>
                            {isRead && (                              <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-primary text-primary-foreground text-xs px-1.5 py-0.5 rounded-full font-semibold">
                                <CheckCheck size={9} /> Lido
                              </div>
                            )}
                          </div>
                          <div>
                            <h3 className="text-xs sm:text-sm font-semibold text-foreground leading-snug line-clamp-2 group-hover:text-primary transition-colors" style={{ fontFamily: "'Playfair Display', serif" }}>
                              {book.title}
                            </h3>
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">{book.author}</p>
                            <div className="flex items-center gap-1 mt-1">
                              <Star size={9} className="text-primary fill-primary" />
                              <span className="text-xs text-muted-foreground" style={{ fontFamily: "'DM Mono', monospace" }}>{book.rating}</span>
                            </div>
                            {bookTags.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {bookTags.slice(0, 2).map((tag) => (
                                  <TagChip key={tag.id} tag={tag} small />
                                ))}
                                {bookTags.length > 2 && <span className="text-[10px] text-muted-foreground">+{bookTags.length - 2}</span>}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {view === "add" && (
            <BookForm
              initial={EMPTY_FORM}
              onSubmit={handleAdd}
              onCancel={() => setView("catalog")}
              isEdit={false}
              tags={tags}
              onToast={showToast}
            />
          )}

          {view === "edit" && editingBook && (
            <BookForm
              initial={{
                title: editingBook.title,
                author: editingBook.author,
                genre: editingBook.genre,
                year: String(editingBook.year),
                rating: String(editingBook.rating),
                pages: String(editingBook.pages),
                cover: editingBook.cover,
                description: editingBook.description,
                featured: editingBook.featured,
                tagIds: editingBook.tagIds,
              }}
              onSubmit={handleEdit}
              onCancel={() => { setView("catalog"); setEditingBook(null); }}
              isEdit={true}
              tags={tags}
              onToast={showToast}
            />
          )}

          {view === "tags" && <TagsPage tags={tags} books={books} onReload={async () => { await reloadTags(); await reloadBooks(); }} />}
        </main>
      </div>

      {/* Book detail modal */}
      {selectedBook && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={() => setSelectedBook(null)}>
          <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" />
          <div className="relative bg-card w-full sm:max-w-lg sm:rounded-3xl rounded-t-3xl shadow-2xl overflow-hidden max-h-[92dvh] sm:max-h-[85dvh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-center pt-3 pb-1 sm:hidden shrink-0">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>
            <div className="flex flex-col sm:flex-row overflow-hidden flex-1 min-h-0">
              <div className="w-full h-44 sm:w-44 sm:h-auto shrink-0 bg-accent">
                <img src={selectedBook.cover} alt={selectedBook.title} className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 p-5 sm:p-6 flex flex-col gap-3 overflow-y-auto">
                <div className="flex justify-between items-start">
                  <p className="text-xs text-muted-foreground" style={{ fontFamily: "'DM Mono', monospace" }}>{selectedBook.genre} · {selectedBook.year}</p>
                  <button onClick={() => setSelectedBook(null)} className="text-muted-foreground hover:text-foreground hidden sm:block"><X size={18} /></button>
                </div>
                <div>
                  <h2 className="text-lg sm:text-xl font-bold text-foreground leading-tight" style={{ fontFamily: "'Playfair Display', serif" }}>{selectedBook.title}</h2>
                  <p className="text-sm text-muted-foreground mt-0.5">{selectedBook.author}</p>
                </div>

                {selectedBook.tagIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {tags.filter((t) => selectedBook.tagIds.includes(t.id)).map((tag) => (
                      <TagChip key={tag.id} tag={tag} />
                    ))}
                  </div>
                )}

                <p className="text-sm text-foreground/80 leading-relaxed line-clamp-4">{selectedBook.description}</p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground" style={{ fontFamily: "'DM Mono', monospace" }}>
                  <span className="flex items-center gap-1"><Star size={10} className="text-primary fill-primary" />{selectedBook.rating}</span>
                  {selectedBook.pages > 0 && <span>{selectedBook.pages} pág.</span>}
                </div>

                <div className="flex flex-col gap-2 mt-auto pt-1">
                  <button
                    onClick={() => toggleRead(selectedBook.id)}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all ${readBooks.includes(selectedBook.id) ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-accent text-foreground"}`}
                  >
                    <CheckCheck size={14} />
                    {readBooks.includes(selectedBook.id) ? "Marcado como lido" : "Marcar como lido"}
                  </button>
                  <div className="flex gap-2">
                    <button onClick={() => toggleFav(selectedBook.id)} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-secondary hover:bg-accent transition-colors text-sm font-semibold">
                      <Heart size={14} className={favorites.includes(selectedBook.id) ? "text-primary fill-primary" : "text-muted-foreground"} />
                      {favorites.includes(selectedBook.id) ? "Favoritado" : "Favoritar"}
                    </button>
                    <button onClick={() => openEdit(selectedBook)} className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-accent hover:bg-secondary transition-colors text-sm font-semibold text-foreground">
                      <Pencil size={13} /> Editar
                    </button>
                    <button
                      onClick={() => setConfirmDelete(selectedBook)}
                      className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-destructive/10 hover:bg-destructive/20 transition-colors text-sm font-semibold text-destructive"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}

      {/* Confirm delete dialog */}
      {confirmDelete && (
        <ConfirmDialog
          message={`Tem certeza que deseja excluir "${confirmDelete.title}" do acervo do Bi-Bip?`}
          onConfirm={() => handleDelete(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {/* Inject animation keyframes */}
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
