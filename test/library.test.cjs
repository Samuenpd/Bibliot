const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {DatabaseSync}=require("node:sqlite");
const AdmZip=require("adm-zip");
const {createLibrary,duplicateMatches,SCHEMA_VERSION}=require("../electron/db.cjs");
const {createDataService,parseCsv}=require("../electron/data-service.cjs");

const roots=[];const temp=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),"bibip-test-"));roots.push(root);return root;};
test.after(()=>roots.forEach(root=>fs.rmSync(root,{recursive:true,force:true})));
const book=(overrides={})=>({title:"Livro",author:"Autora",genre:"Romance",year:2020,rating:4,pages:100,cover:"",description:"",featured:false,tagIds:[],format:"Físico",location:"",borrowedBy:"",notes:"",isbn:"",edition:"",publisher:"",readingStatus:"want_to_read",currentPage:0,...overrides});

test("excluir tudo exige confirmação exata e não altera dados sem ela",()=>{
  const root=temp(),lib=createLibrary(root),service=createDataService(()=>lib,async()=>{});
  try {
    lib.booksApi.add(book());
    fs.writeFileSync(path.join(root,"covers","capa.jpg"),"capa");
    for(const confirmation of [undefined,null,"","BIBIP","bibip ","outro"])
      assert.throws(()=>service.clearLibrary(confirmation),/bibip/);
    assert.equal(lib.booksApi.getAll().length,1);
    assert.equal(fs.readFileSync(path.join(root,"covers","capa.jpg"),"utf8"),"capa");
  } finally {lib.close();}
});

test("excluir tudo limpa o acervo e mantém outros arquivos, pastas e bibliotecas",()=>{
  const root=temp(),other=createLibrary(temp());let lib=createLibrary(root);
  try {
    const service=createDataService(()=>lib,async()=>{});
    const tagId=lib.tagsApi.add({name:"Minha tag",color:"#fff"});
    const id=lib.booksApi.add(book({tagIds:[tagId],isFavorite:true}));
    lib.booksApi.addNote(id,"Nota");lib.booksApi.addLoan(id,"Ana","2026-01-01",null);
    lib.booksApi.updateReading(id,{status:"reading",currentPage:12});
    fs.writeFileSync(path.join(root,"covers","capa.jpg"),"capa");
    fs.writeFileSync(path.join(root,"outro-arquivo.txt"),"preservar");
    other.booksApi.add(book({title:"Outra biblioteca"}));
    assert.equal(service.clearLibrary("bibip"),true);
    for(const table of ["books","tags","book_tags","book_notes","book_loans","reading_sessions"])
      assert.equal(lib.db.prepare(`SELECT count(*) total FROM ${table}`).get().total,0,table);
    assert.deepEqual(fs.readdirSync(path.join(root,"covers")),[]);
    assert.equal(fs.readFileSync(path.join(root,"outro-arquivo.txt"),"utf8"),"preservar");
    assert.equal(other.booksApi.getAll()[0].title,"Outra biblioteca");
    assert.ok(lib.integrityCheck());
    lib.close();lib=createLibrary(root);
    assert.deepEqual(lib.booksApi.getAll(),[]);assert.deepEqual(lib.tagsApi.getAll(),[]);
    assert.equal(service.clearLibrary("bibip"),true);
    assert.ok(lib.booksApi.add(book()));
    assert.equal(fs.readdirSync(root).some(name=>name.startsWith(".bibip-clear-")),false);
  } finally {lib.close();other.close();}
});

test("falha ao excluir restaura capas e reverte a transação",()=>{
  const root=temp(),lib=createLibrary(root),service=createDataService(()=>lib,async()=>{});
  try {
    const id=lib.booksApi.add(book());lib.booksApi.addNote(id,"Preservar nota");
    fs.writeFileSync(path.join(root,"covers","capa.jpg"),"Preservar capa");
    lib.db.exec("CREATE TRIGGER prevent_clear BEFORE DELETE ON books BEGIN SELECT RAISE(ABORT, 'falha simulada'); END");
    assert.throws(()=>service.clearLibrary("bibip"),/falha simulada/);
    assert.equal(lib.booksApi.getAll().length,1);
    assert.equal(lib.booksApi.getNotes(id)[0].content,"Preservar nota");
    assert.equal(fs.readFileSync(path.join(root,"covers","capa.jpg"),"utf8"),"Preservar capa");
    assert.equal(fs.readdirSync(root).some(name=>name.startsWith(".bibip-clear-")),false);
  } finally {lib.close();}
});

test("inicializa diretório vazio e reabre biblioteca existente",()=>{const root=temp();let lib=createLibrary(root);assert.ok(fs.existsSync(path.join(root,"biblioteca.db")));assert.ok(fs.existsSync(path.join(root,"covers")));lib.booksApi.add(book());lib.close();lib=createLibrary(root);assert.equal(lib.booksApi.getAll().length,1);assert.equal(lib.db.prepare("PRAGMA user_version").get().user_version,SCHEMA_VERSION);lib.close();});

test("migra is_read preservando lidos, não lidos, tags, notas e empréstimos",()=>{const root=temp(),db=new DatabaseSync(path.join(root,"biblioteca.db"));db.exec(`CREATE TABLE books(id INTEGER PRIMARY KEY,title TEXT NOT NULL,author TEXT NOT NULL,is_read INTEGER DEFAULT 0,is_favorite INTEGER DEFAULT 0,pages INTEGER DEFAULT 0);CREATE TABLE tags(id INTEGER PRIMARY KEY,name TEXT,color TEXT);CREATE TABLE book_tags(book_id INTEGER,tag_id INTEGER,PRIMARY KEY(book_id,tag_id));CREATE TABLE book_notes(id INTEGER PRIMARY KEY,book_id INTEGER,content TEXT,created_at TEXT,updated_at TEXT);CREATE TABLE book_loans(id INTEGER PRIMARY KEY,book_id INTEGER,borrower TEXT,lent_at TEXT,due_at TEXT,returned_at TEXT);INSERT INTO books VALUES(1,'Lido','A',1,0,100),(2,'Pendente','B',0,0,80);INSERT INTO tags VALUES(1,'Minha tag','#fff');INSERT INTO book_tags VALUES(1,1);INSERT INTO book_notes VALUES(1,1,'nota','2020','2020');INSERT INTO book_loans VALUES(1,1,'Pessoa','2020',NULL,NULL);`);db.close();const lib=createLibrary(root),books=lib.booksApi.getAll();assert.equal(books.find(b=>b.id===1).readingStatus,"completed");assert.equal(books.find(b=>b.id===2).readingStatus,"want_to_read");assert.equal(lib.booksApi.getNotes(1).length,1);assert.equal(lib.booksApi.getLoans(1).length,1);assert.deepEqual(books.find(b=>b.id===1).tagIds,[1]);lib.close();});

test("atualiza progresso, valida limites e preserva releitura",()=>{const lib=createLibrary(temp()),id=lib.booksApi.add(book());lib.booksApi.updateReading(id,{status:"reading",currentPage:20});assert.equal(lib.booksApi.get(id).currentPage,20);assert.throws(()=>lib.booksApi.updateReading(id,{status:"reading",currentPage:101}),/entre zero/);lib.booksApi.updateReading(id,{status:"completed",currentPage:100});lib.booksApi.startReread(id,"2026-01-02T00:00:00.000Z");const sessions=lib.booksApi.getReadingSessions(id);assert.equal(sessions.length,2);assert.equal(sessions[1].status,"completed");assert.equal(sessions[0].status,"reading");lib.close();});

test("detecta duplicatas fortes e prováveis sem impedir dois exemplares",()=>{const lib=createLibrary(temp()),one=book({isbn:"9788535902778",edition:"1",publisher:"Casa"});const id=lib.booksApi.add(one);assert.equal(duplicateMatches(one,lib.booksApi.getAll())[0].confidence,"strong");assert.equal(lib.booksApi.findDuplicates(book({title:"  LÍVRO! ",author:"autora",edition:"1"}))[0].confidence,"probable");const second=lib.booksApi.add(one);assert.notEqual(id,second);assert.equal(lib.booksApi.getAll().length,2);lib.close();});

test("interpreta CSV UTF-8 com aspas, separador e quebra de linha",()=>{const rows=parseCsv('Título;Autor;Descrição\r\n"Um; livro";José;"linha 1\nlinha 2"');assert.equal(rows[1][0],"Um; livro");assert.equal(rows[1][2],"linha 1\nlinha 2");});

test("importa CSV e JSON exportado preservando relacionamentos",()=>{const root=temp(),lib=createLibrary(root),csv=path.join(root,"in.csv");fs.writeFileSync(csv,"Título;Autor;Páginas\nImportado;Alguém;50","utf8");const service=createDataService(()=>lib,async()=>{}),preview=service.previewImport(csv);assert.equal(preview.rows[0].valid,true);service.importRows(preview.rows,[0]);const tagId=lib.tagsApi.add({name:"Especial",color:"#123456"}),id=lib.booksApi.add(book({title:"Com relações",tagIds:[tagId]}));lib.booksApi.addNote(id,"lembrança");lib.booksApi.addLoan(id,"Ana","2026-01-01",null);lib.booksApi.updateReading(id,{status:"reading",currentPage:12});const json=path.join(root,"out.json");service.exportJson(json);const root2=temp(),lib2=createLibrary(root2),service2=createDataService(()=>lib2,async()=>{}),p2=service2.previewImport(json);service2.importRows(p2.rows,p2.rows.map(r=>r.index));const restored=lib2.booksApi.getAll().find(b=>b.title==="Com relações");assert.ok(restored);assert.equal(lib2.booksApi.getNotes(restored.id)[0].content,"lembrança");assert.equal(lib2.booksApi.getLoans(restored.id)[0].borrower,"Ana");assert.equal(lib2.booksApi.getReadingSessions(restored.id).length,1);assert.ok(restored.tagIds.length);lib.close();lib2.close();});

test("backup e restauração incluem capas e recuperam falha sem perder dados",async()=>{const root=temp();let lib=createLibrary(root);lib.booksApi.add(book({title:"Original"}));fs.writeFileSync(path.join(root,"covers","capa.jpg"),"imagem");const replace=async operation=>{const storage=lib.storageRoot;lib.close();try{await operation(storage);lib=createLibrary(storage);}catch(error){lib=createLibrary(storage);throw error;}};const service=createDataService(()=>lib,replace),zip=path.join(temp(),"backup.zip");await service.createBackup(zip);lib.booksApi.add(book({title:"Depois"}));assert.equal(service.validateBackup(zip).format,"bibip-backup");await service.restoreBackup(zip);assert.deepEqual(lib.booksApi.getAll().map(b=>b.title),["Original"]);assert.equal(fs.readFileSync(path.join(root,"covers","capa.jpg"),"utf8"),"imagem");const badRoot=temp(),badDb=path.join(badRoot,"biblioteca.db"),bad=new DatabaseSync(badDb);bad.exec("CREATE VIEW schema_migrations AS SELECT 1 version, 'x' applied_at");bad.close();const invalidZip=path.join(badRoot,"valid-sqlite-invalid-schema.zip"),archive=new AdmZip();archive.addLocalFile(badDb);archive.addFile("manifest.json",Buffer.from(JSON.stringify({format:"bibip-backup",formatVersion:1,schemaVersion:3,createdAt:new Date().toISOString()})));archive.writeZip(invalidZip);await assert.rejects(()=>service.restoreBackup(invalidZip));assert.deepEqual(lib.booksApi.getAll().map(b=>b.title),["Original"]);assert.equal(fs.readFileSync(path.join(root,"covers","capa.jpg"),"utf8"),"imagem");lib.close();});

test("protege biblioteca existente na lógica de transferência",()=>{const a=createLibrary(temp()),b=createLibrary(temp());a.booksApi.add(book({title:"Origem"}));b.booksApi.add(book({title:"Destino"}));assert.equal(a.booksApi.getAll()[0].title,"Origem");assert.equal(b.booksApi.getAll()[0].title,"Destino");a.close();b.close();});

test("JSON preserva favorito, responsável pelo empréstimo e datas de leitura",()=>{
  const source=createLibrary(temp()),target=createLibrary(temp());
  try {
    const reading=source.booksApi.add(book({title:"Em leitura",isFavorite:true}));
    source.booksApi.addLoan(reading,"Ana","2026-01-01",null);
    source.booksApi.updateReading(reading,{status:"reading",currentPage:12,startedAt:"2026-01-02T00:00:00.000Z"});
    const completed=source.booksApi.add(book({title:"Concluído"}));
    source.booksApi.updateReading(completed,{status:"completed",startedAt:"2026-01-03T00:00:00.000Z",completedAt:"2026-01-05T00:00:00.000Z"});
    const file=path.join(temp(),"roundtrip.json");
    createDataService(()=>source,async()=>{}).exportJson(file);
    const service=createDataService(()=>target,async()=>{}),preview=service.previewImport(file);
    service.importRows(preview.rows,preview.rows.map(row=>row.index));
    for(const original of source.booksApi.getAll()){
      const restored=target.booksApi.getAll().find(item=>item.title===original.title);
      for(const field of ["isFavorite","borrowedBy","readingStatus","currentPage","readingStartedAt","readingCompletedAt"])
        assert.equal(restored[field],original[field],`${original.title}: ${field}`);
      assert.deepEqual(target.booksApi.getLoans(restored.id).map(({id,bookId,...loan})=>loan),source.booksApi.getLoans(original.id).map(({id,bookId,...loan})=>loan));
    }
    const restored=target.booksApi.getAll().find(item=>item.title==="Em leitura");
    target.booksApi.update(restored.id,{...restored,title:"Título editado"});
    assert.equal(target.booksApi.get(restored.id).isFavorite,true);
  } finally {source.close();target.close();}
});

test("mapeamento permite ignorar colunas reconhecidas e mantém reconhecimento automático",()=>{
  const lib=createLibrary(temp());
  try {
    const service=createDataService(()=>lib,async()=>{}),file=path.join(temp(),"mapping.csv");
    fs.writeFileSync(file,"Título;Autor;Páginas;Descrição\nLivro;Autora;100;Texto");
    assert.equal(service.previewImport(file).rows[0].book.pages,100);
    const ignored=service.previewImport(file,{"Páginas":"",descricao:""}).rows[0];
    assert.equal(ignored.valid,true);
    assert.equal(ignored.book.pages,0);
    assert.equal(ignored.book.description,"");
    assert.equal(ignored.book.title,"Livro");
    assert.equal(service.previewImport(file,{"Título":""}).rows[0].valid,false);
    assert.equal(service.previewImport(file,{"Páginas":"year"}).rows[0].book.year,100);
  } finally {lib.close();}
});
