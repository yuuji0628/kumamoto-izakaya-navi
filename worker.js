
const enc = new TextEncoder();

function json(data, init={}) {
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), {...init, headers});
}

function text(s, init={}) {
  return new Response(s, init);
}

function nowIso() {
  return new Date().toISOString();
}

function clean(v, max=2000) {
  return String(v ?? "").trim().slice(0, max);
}

function bool(v) {
  return v === true || v === 1 || v === "1" || v === "true" ? 1 : 0;
}

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromB64url(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const raw = atob(s);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

async function sha256Bytes(input) {
  const data = typeof input === "string" ? enc.encode(input) : input;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

async function hashToken(token) {
  return b64url(await sha256Bytes(token));
}

async function hashPassword(password, saltB64) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    {name: "PBKDF2"},
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: fromB64url(saltB64),
      iterations: 20000
    },
    key,
    256
  );
  return b64url(new Uint8Array(bits));
}


const GITHUB_EDITABLE_FILES = new Set([
  "index.html","style.css","script.js","admin.html","admin-login.html","worker.js","wrangler.jsonc",
  "listing-form.html","izakayas.html","shop.html","jobs.html","areas.html","contact.html","robots.txt"
]);

function githubConfig(env) {
  return {
    owner: clean(env.GITHUB_OWNER || "yuuji0628", 100),
    repo: clean(env.GITHUB_REPO || "kumamoto-izakaya-navi", 120),
    branch: clean(env.GITHUB_BRANCH || "main", 100),
    token: String(env.GITHUB_TOKEN || "").trim()
  };
}

function githubHeaders(token) {
  return {
    "Accept": "application/vnd.github+json",
    "Authorization": `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "KUMAMOTO-IZAKAYA-NAVI-ADMIN"
  };
}

function utf8ToBase64(str) {
  const bytes = enc.encode(String(str));
  let bin = "";
  const chunk = 0x8000;
  for (let i=0;i<bytes.length;i+=chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i+chunk));
  }
  return btoa(bin);
}

function base64ToUtf8(str) {
  const bin = atob(String(str || "").replace(/\n/g,""));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function githubApi(env, path, init={}) {
  const c = githubConfig(env);
  if (!c.token) {
    const e = new Error("GITHUB_TOKEN_MISSING");
    e.code = "GITHUB_TOKEN_MISSING";
    throw e;
  }
  const r = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      ...githubHeaders(c.token),
      ...(init.headers || {})
    }
  });
  const raw = await r.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = {message:raw}; }
  if (!r.ok) {
    const e = new Error(data?.message || `GITHUB_HTTP_${r.status}`);
    e.status = r.status;
    e.data = data;
    throw e;
  }
  return data;
}

function randomToken(bytes=32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return b64url(a);
}

function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i=0; i<a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function parseFeatures(v) {
  if (Array.isArray(v)) return v.map(x => clean(x, 80)).filter(Boolean).slice(0, 12);
  const s = clean(v, 1000);
  if (!s) return [];
  try {
    const j = JSON.parse(s);
    if (Array.isArray(j)) return j.map(x => clean(x, 80)).filter(Boolean).slice(0,12);
  } catch {}
  return s.split(/[、,，]/).map(x => x.trim()).filter(Boolean).slice(0,12);
}

function featuresJson(v) {
  return JSON.stringify(parseFeatures(v));
}

function rowShop(r) {
  if (!r) return r;
  return {
    ...r,
    features: parseFeatures(r.features),
    is_published: Number(r.is_published || 0)
  };
}

function slugify(name) {
  const a = clean(name, 140)
    .toLowerCase()
    .normalize("NFKC")
    .replace(/['’"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return a || `shop-${Date.now().toString(36)}`;
}

let schemaPromise;
async function ensureSchema(env) {
  if (!env.DB) throw new Error("DB_BINDING_MISSING");

  if (!schemaPromise) {
    const statements = [
      `CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS site_settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS admin_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(admin_id) REFERENCES admins(id)
      )`,

      `CREATE TABLE IF NOT EXISTS shops (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        area TEXT DEFAULT '',
        genre TEXT DEFAULT '',
        address TEXT DEFAULT '',
        hours TEXT DEFAULT '',
        holiday TEXT DEFAULT '',
        budget TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        instagram TEXT DEFAULT '',
        features TEXT DEFAULT '[]',
        description TEXT DEFAULT '',
        is_published INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shop_name TEXT NOT NULL,
        contact_name TEXT DEFAULT '',
        email TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        area TEXT DEFAULT '',
        genre TEXT DEFAULT '',
        address TEXT DEFAULT '',
        hours TEXT DEFAULT '',
        holiday TEXT DEFAULT '',
        budget TEXT DEFAULT '',
        instagram TEXT DEFAULT '',
        features TEXT DEFAULT '',
        description TEXT DEFAULT '',
        wants_job INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        reviewed_at TEXT DEFAULT ''
      )`,

      `CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shop_id INTEGER,
        title TEXT NOT NULL,
        salary TEXT DEFAULT '',
        employment_type TEXT DEFAULT '',
        description TEXT DEFAULT '',
        is_published INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(shop_id) REFERENCES shops(id)
      )`,

      `CREATE INDEX IF NOT EXISTS idx_shops_published
        ON shops(is_published, updated_at)`,

      `CREATE INDEX IF NOT EXISTS idx_submissions_status
        ON submissions(status, created_at)`,

      `CREATE TABLE IF NOT EXISTS lead_candidates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        area TEXT DEFAULT '',
        genre TEXT DEFAULT '',
        address TEXT DEFAULT '',
        source_url TEXT DEFAULT '',
        instagram TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        snippet TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'new',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,

      `CREATE INDEX IF NOT EXISTS idx_lead_candidates_status
        ON lead_candidates(status, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_token
        ON admin_sessions(token_hash)`
    ];

    schemaPromise = env.DB.batch(
      statements.map(sql => env.DB.prepare(sql))
    ).catch(err => {
      schemaPromise = null;
      throw err;
    });
  }

  await schemaPromise;
}

async function ensureKinExtendedSchema(env) {
  await ensureSchema(env);

  const info = await env.DB.prepare("PRAGMA table_info(shops)").all();
  const cols = new Set((info.results || []).map(x => String(x.name || "")));
  const additions = [
    ["budget_min","INTEGER"],
    ["budget_max","INTEGER"],
    ["seats","INTEGER"],
    ["is_featured","INTEGER NOT NULL DEFAULT 0"],
    ["is_new","INTEGER NOT NULL DEFAULT 1"],
    ["sort_order","INTEGER NOT NULL DEFAULT 100"],
    ["listing_status","TEXT NOT NULL DEFAULT 'published'"],
    ["published_at","TEXT DEFAULT ''"],
    ["business_status","TEXT DEFAULT 'OPERATIONAL'"],
    ["website","TEXT DEFAULT ''"]
  ];
  for (const [name,type] of additions) {
    if (!cols.has(name)) {
      await env.DB.prepare(`ALTER TABLE shops ADD COLUMN ${name} ${type}`).run();
    }
  }

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS kin_admin_alerts(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT DEFAULT '',
      shop_id INTEGER,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS shop_analytics(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `).run();

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_kin_alerts_read
    ON kin_admin_alerts(is_read, id DESC)
  `).run().catch(()=>{});
}

function kinListingStatus(v){
  return String(v||"").toLowerCase()==="provisional"?"provisional":"published";
}
function kinPublicShop(r){
  if(!r)return r;
  const features=parseFeatures(r.features);
  const provisional=kinListingStatus(r.listing_status)==="provisional";
  const min=Number.isFinite(Number(r.budget_min))?Number(r.budget_min):null;
  const max=Number.isFinite(Number(r.budget_max))?Number(r.budget_max):null;
  let budget=String(r.budget||"").trim();
  if(!budget && (min!==null || max!==null)){
    if(min!==null && max!==null)budget=`${min.toLocaleString("ja-JP")}〜${max.toLocaleString("ja-JP")}円`;
    else if(min!==null)budget=`${min.toLocaleString("ja-JP")}円〜`;
    else budget=`〜${max.toLocaleString("ja-JP")}円`;
  }
  return {
    ...r,
    features,
    budget,
    listing_status:provisional?"provisional":"published",
    is_provisional:provisional?1:0,
    name:provisional?`【KIN独自掲載】${String(r.name||"").replace(/^【KIN独自掲載】/,"")}`:r.name
  };
}

async function kinAlert(env,{type="info",title="お知らせ",message="",shopId=null}={}){
  await ensureKinExtendedSchema(env);
  await env.DB.prepare(`
    INSERT INTO kin_admin_alerts(alert_type,title,message,shop_id,is_read,created_at)
    VALUES(?,?,?,?,0,?)
  `).bind(
    clean(type,50),clean(title,180),clean(message,2000),
    shopId===null?null:Number(shopId),nowIso()
  ).run();
}

function kinGoogleKey(env){
  return String(
    env.GOOGLE_PLACES_API_KEY ||
    env.GOOGLE_MAPS_API_KEY ||
    env.GOOGLE_API_KEY || ""
  ).trim();
}

async function kinGoogleTextSearch(env,query,max=8){
  const key=kinGoogleKey(env);
  if(!key)return {ok:false,error:"GOOGLE_PLACES_KEY_MISSING",places:[]};
  try{
    const r=await fetch("https://places.googleapis.com/v1/places:searchText",{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "X-Goog-Api-Key":key,
        "X-Goog-FieldMask":"places.id,places.displayName,places.formattedAddress,places.primaryType,places.types,places.businessStatus"
      },
      body:JSON.stringify({textQuery:query,languageCode:"ja",regionCode:"JP",pageSize:Math.max(1,Math.min(Number(max)||8,20))})
    });
    const d=await r.json().catch(()=>({}));
    if(!r.ok)return {ok:false,error:d?.error?.message||`GOOGLE_HTTP_${r.status}`,places:[]};
    return {ok:true,places:Array.isArray(d.places)?d.places:[]};
  }catch(e){
    return {ok:false,error:String(e?.message||e),places:[]};
  }
}

async function kinGoogleDetails(env,id){
  const key=kinGoogleKey(env);
  if(!key||!id)return {ok:false,place:null};
  try{
    const mask=[
      "id","displayName","formattedAddress","primaryType","types","businessStatus",
      "nationalPhoneNumber","internationalPhoneNumber","regularOpeningHours",
      "websiteUri","priceLevel","priceRange","googleMapsUri"
    ].join(",");
    const r=await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`,{
      headers:{
        "X-Goog-Api-Key":key,
        "X-Goog-FieldMask":mask,
        "Accept-Language":"ja"
      }
    });
    const d=await r.json().catch(()=>({}));
    if(!r.ok)return {ok:false,place:null,error:d?.error?.message||`GOOGLE_HTTP_${r.status}`};
    return {ok:true,place:d};
  }catch(e){
    return {ok:false,place:null,error:String(e?.message||e)};
  }
}

function kinPlaceName(p){return clean(p?.displayName?.text||p?.name||"",180)}
function kinHours(p){
  const a=p?.regularOpeningHours?.weekdayDescriptions;
  return Array.isArray(a)?a.join(" / "):"";
}
function kinHoliday(p){
  const a=p?.regularOpeningHours?.weekdayDescriptions;
  if(!Array.isArray(a))return "";
  return a.filter(x=>/休業|定休|closed/i.test(String(x))).map(x=>String(x).split(":")[0].trim()).join("・");
}
function kinPhone(p){return clean(p?.nationalPhoneNumber||p?.internationalPhoneNumber||"",100)}
function kinWebsite(p){return clean(p?.websiteUri||"",600)}
function kinPrice(p){
  const level=String(p?.priceLevel||"").toUpperCase();
  const table={
    PRICE_LEVEL_FREE:[0,0],
    PRICE_LEVEL_INEXPENSIVE:[1000,3000],
    PRICE_LEVEL_MODERATE:[3000,5000],
    PRICE_LEVEL_EXPENSIVE:[5000,8000],
    PRICE_LEVEL_VERY_EXPENSIVE:[8000,15000]
  };
  return table[level]||[null,null];
}

function kinNameNorm(v){
  return String(v||"").normalize("NFKC").toLowerCase()
    .replace(/【kin独自掲載】/ig,"")
    .replace(/[^\p{L}\p{N}]/gu,"");
}
function kinNameScore(a,b){
  const x=kinNameNorm(a),y=kinNameNorm(b);
  if(!x||!y)return 0;
  if(x===y)return 100;
  if(x.includes(y)||y.includes(x))return 92;
  const big=s=>new Set([...Array(Math.max(0,s.length-1))].map((_,i)=>s.slice(i,i+2)));
  const A=big(x),B=big(y);
  if(!A.size||!B.size)return 0;
  let hit=0; for(const z of A)if(B.has(z))hit++;
  return Math.round(200*hit/(A.size+B.size));
}

function kinInstagramHandle(url){
  const s=String(url||"").trim();
  const m=s.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  if(m && !["p","reel","reels","stories","explore","accounts","direct"].includes(m[1].toLowerCase()))return m[1];
  if(/^@?[A-Za-z0-9._]+$/.test(s))return s.replace(/^@/,"");
  return "";
}

async function kinOfficialInstagram(website){
  if(!/^https?:\/\//i.test(String(website||"")))return "";
  try{
    const r=await fetch(website,{headers:{"User-Agent":"KUMAMOTO-IZAKAYA-NAVI/1.19"}});
    if(!r.ok)return "";
    const html=(await r.text()).slice(0,260000);
    for(const m of html.matchAll(/https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]+)/gi)){
      const h=kinInstagramHandle(m[0]);
      if(h)return `https://www.instagram.com/${h}/`;
    }
  }catch{}
  return "";
}

async function kinInstagramSearch(env,{name,area,website=""}={}){
  const official=await kinOfficialInstagram(website);
  if(official)return {instagram:official,score:100,source:"official_website"};

  const key=String(env.SERPAPI_API_KEY||"").trim();
  if(!key)return {instagram:"",score:0,source:"none"};

  const u=new URL("https://serpapi.com/search.json");
  u.searchParams.set("engine","google");
  u.searchParams.set("q",`"${name}" Instagram ${area||"熊本"} 熊本`);
  u.searchParams.set("hl","ja");u.searchParams.set("gl","jp");
  u.searchParams.set("num","10");u.searchParams.set("api_key",key);
  try{
    const r=await fetch(u);
    if(!r.ok)return {instagram:"",score:0,source:"serpapi"};
    const d=await r.json();
    let best=null;
    for(const item of (d.organic_results||[])){
      const h=kinInstagramHandle(item.link||"");
      if(!h)continue;
      const text=`${item.title||""} ${item.snippet||""}`;
      let score=Math.round(kinNameScore(name,text)*.75);
      if(area && text.includes(area))score+=10;
      if(/熊本/.test(text))score+=7;
      if(/居酒屋|酒場|焼鳥|やきとり|海鮮|和食|料理|dining/i.test(text))score+=5;
      if(/公式|official/i.test(text))score+=8;
      score=Math.min(99,score);
      if(!best||score>best.score)best={instagram:`https://www.instagram.com/${h}/`,score,source:"serpapi"};
    }
    return best&&best.score>=90?best:{instagram:"",score:best?.score||0,source:"serpapi",candidate:best};
  }catch{
    return {instagram:"",score:0,source:"serpapi"};
  }
}

async function kinFindGoogleShop(env,name,area){
  const r=await kinGoogleTextSearch(env,`${name} ${area||"熊本"} 熊本 居酒屋`,5);
  if(!r.ok)return {ok:false,error:r.error};
  let best=null;
  for(const p of r.places){
    const n=kinPlaceName(p),addr=String(p.formattedAddress||"");
    if(!addr.includes("熊本"))continue;
    let score=kinNameScore(name,n);
    if(area && addr.includes(area))score+=8;
    if(!best||score>best.score)best={place:p,score};
  }
  return best&&best.score>=72?{ok:true,matched:true,...best}:{ok:true,matched:false,score:best?.score||0};
}

const KIN_DISCOVERY_PAIRS = [
  ["熊本市","居酒屋"],["熊本市","郷土料理"],["熊本市","海鮮居酒屋"],["熊本市","焼き鳥"],
  ["熊本市","焼肉居酒屋"],["熊本市","創作居酒屋"],["熊本市","個室居酒屋"],["八代市","居酒屋"],
  ["天草市","居酒屋"],["人吉市","居酒屋"],["玉名市","居酒屋"],["山鹿市","居酒屋"],
  ["菊池市","居酒屋"],["宇城市","居酒屋"],["阿蘇市","居酒屋"],["合志市","居酒屋"]
];

async function kinAutoDiscover(env,{maxListings=12,pairLimit=8,perPairLimit=3}={}){
  await ensureKinExtendedSchema(env);
  const created=[],searched=[],rejected=[];
  const max=Math.max(1,Math.min(Number(maxListings)||12,25));
  for(const [area,kind] of KIN_DISCOVERY_PAIRS.slice(0,Math.max(1,Math.min(Number(pairLimit)||8,KIN_DISCOVERY_PAIRS.length)))){
    if(created.length>=max)break;
    const q=`${area} ${kind} 熊本`;
    const sr=await kinGoogleTextSearch(env,q,Math.max(3,Math.min(Number(perPairLimit)||3,8)));
    searched.push({area,type:kind,query:q,ok:sr.ok,raw_found:sr.places?.length||0,error:sr.error||""});
    if(!sr.ok)continue;
    for(const p of sr.places){
      if(created.length>=max)break;
      const name=kinPlaceName(p),address=clean(p.formattedAddress,400);
      if(!name||!address||!address.includes("熊本"))continue;
      const dup=await env.DB.prepare(`
        SELECT id FROM shops
        WHERE lower(replace(name,' ',''))=lower(replace(?,' ',''))
           OR (address<>'' AND address=?)
        LIMIT 1
      `).bind(name,address).first();
      if(dup){rejected.push({name,reason:"DUPLICATE"});continue;}

      const dr=await kinGoogleDetails(env,p.id);
      const gp=dr.ok?dr.place:p;
      const [bmin,bmax]=kinPrice(gp);
      let website=kinWebsite(gp);
      const ig=await kinInstagramSearch(env,{name,area,website});
      const t=nowIso();
      let slug=slugify(name);
      const ex=await env.DB.prepare("SELECT id FROM shops WHERE slug=?").bind(slug).first();
      if(ex)slug+=`-${Date.now().toString(36)}`;

      const r=await env.DB.prepare(`
        INSERT INTO shops(
          slug,name,area,genre,address,hours,holiday,budget,phone,instagram,features,description,
          is_published,created_at,updated_at,budget_min,budget_max,seats,is_featured,is_new,
          sort_order,listing_status,published_at,business_status,website
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        slug,name,area,kind,address,kinHours(gp),kinHoliday(gp),"",kinPhone(gp),ig.instagram||"",
        JSON.stringify([]),
        `${area}の${kind}として公開情報をもとにKUMAMOTO IZAKAYA NAVIが独自掲載しています。`,
        1,t,t,bmin,bmax,null,0,1,100,"provisional",t,
        String(gp.businessStatus||"OPERATIONAL"),website
      ).run();
      const id=Number(r.meta?.last_row_id||0);
      created.push({shop_id:id,id,name,slug,area,genre:kind,instagram:ig.instagram||"",instagram_score:ig.score||0});
      await kinAlert(env,{
        type:"new_shop",
        title:`新店舗を自動掲載: ${name}`,
        message:`${area} / ${kind} をKIN独自掲載しました。${ig.instagram?" Instagramも高一致で取得済み。":" Instagramは未取得です。"}`,
        shopId:id
      });
    }
  }
  return {ok:true,created,searched,rejected_count:rejected.length,rejected};
}

async function kinRefreshMissing(env,{limit=20,afterId=0}={}){
  await ensureKinExtendedSchema(env);
  const r=await env.DB.prepare(`
    SELECT * FROM shops
    WHERE COALESCE(listing_status,'published')='provisional'
      AND id>?
      AND (
        COALESCE(TRIM(address),'')='' OR COALESCE(TRIM(hours),'')='' OR
        COALESCE(TRIM(phone),'')='' OR COALESCE(TRIM(instagram),'')='' OR
        COALESCE(TRIM(genre),'')='' OR budget_min IS NULL OR budget_max IS NULL
      )
    ORDER BY id ASC LIMIT ?
  `).bind(Number(afterId)||0,Math.max(1,Math.min(Number(limit)||20,40))).all();

  const updated=[],failed=[];
  for(const s of (r.results||[])){
    try{
      const f=await kinFindGoogleShop(env,String(s.name||"").replace(/^【KIN独自掲載】/,""),s.area);
      if(!f.matched)continue;
      const d=await kinGoogleDetails(env,f.place.id);
      const gp=d.ok?d.place:f.place;
      const [bmin,bmax]=kinPrice(gp);
      const website=kinWebsite(gp)||s.website||"";
      let instagram=s.instagram||"";
      if(!instagram){
        const ig=await kinInstagramSearch(env,{name:s.name,area:s.area,website});
        if(ig.instagram && ig.score>=90)instagram=ig.instagram;
      }
      await env.DB.prepare(`
        UPDATE shops SET
          address=?,hours=?,holiday=?,phone=?,instagram=?,budget_min=?,budget_max=?,website=?,
          business_status=?,updated_at=?
        WHERE id=?
      `).bind(
        clean(gp.formattedAddress||s.address,400),
        kinHours(gp)||s.hours||"",kinHoliday(gp)||s.holiday||"",
        kinPhone(gp)||s.phone||"",instagram,
        bmin??s.budget_min,bmax??s.budget_max,website,
        String(gp.businessStatus||s.business_status||"OPERATIONAL"),nowIso(),s.id
      ).run();
      updated.push({id:s.id,name:s.name,instagram});
    }catch(e){failed.push({id:s.id,name:s.name,error:String(e?.message||e).slice(0,200)})}
  }
  const rows=r.results||[];
  const next=rows.length?Number(rows[rows.length-1].id):Number(afterId)||0;
  const more=await env.DB.prepare(`
    SELECT id FROM shops
    WHERE COALESCE(listing_status,'published')='provisional' AND id>?
      AND (COALESCE(TRIM(address),'')='' OR COALESCE(TRIM(hours),'')='' OR
           COALESCE(TRIM(phone),'')='' OR COALESCE(TRIM(instagram),'')='' OR
           budget_min IS NULL OR budget_max IS NULL)
    ORDER BY id ASC LIMIT 1
  `).bind(next).first();
  return {ok:true,checked:rows.length,updated,failed,next_after_id:next,has_more:!!more};
}

async function kinCheckClosed(env,{limit=20,afterId=0}={}){
  await ensureKinExtendedSchema(env);
  const r=await env.DB.prepare(`
    SELECT * FROM shops WHERE is_published=1 AND id>? ORDER BY id ASC LIMIT ?
  `).bind(Number(afterId)||0,Math.max(1,Math.min(Number(limit)||20,50))).all();
  const closed=[],failed=[];
  for(const s of (r.results||[])){
    try{
      const f=await kinFindGoogleShop(env,String(s.name||"").replace(/^【KIN独自掲載】/,""),s.area);
      if(!f.matched)continue;
      const d=await kinGoogleDetails(env,f.place.id);
      const status=String((d.ok?d.place:f.place)?.businessStatus||"");
      await env.DB.prepare("UPDATE shops SET business_status=?,updated_at=? WHERE id=?")
        .bind(status||"OPERATIONAL",nowIso(),s.id).run();
      if(status==="CLOSED_PERMANENTLY"||status==="CLOSED_TEMPORARILY"){
        const existing=await env.DB.prepare(`
          SELECT id FROM kin_admin_alerts
          WHERE alert_type='closed_shop' AND shop_id=? AND is_read=0 LIMIT 1
        `).bind(s.id).first();
        if(!existing){
          await kinAlert(env,{
            type:"closed_shop",
            title:status==="CLOSED_PERMANENTLY"?"閉業の可能性":"一時休業の可能性",
            message:`Google Placesで「${s.name}」が${status==="CLOSED_PERMANENTLY"?"閉業":"一時休業"}として確認されました。`,
            shopId:s.id
          });
        }
        closed.push({id:s.id,name:s.name,business_status:status});
      }
    }catch(e){failed.push({id:s.id,name:s.name,error:String(e?.message||e).slice(0,200)})}
  }
  const rows=r.results||[],next=rows.length?Number(rows[rows.length-1].id):Number(afterId)||0;
  const more=await env.DB.prepare("SELECT id FROM shops WHERE is_published=1 AND id>? ORDER BY id ASC LIMIT 1").bind(next).first();
  return {ok:true,checked:rows.length,closed,failed,next_after_id:next,has_more:!!more};
}

function kinJstToCron(v){
  const m=String(v||"").match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if(!m)return "";
  const total=(Number(m[1])*60+Number(m[2])-540+1440)%1440;
  return `${total%60} ${Math.floor(total/60)} * * *`;
}
function kinCronToJst(v){
  const m=String(v||"").match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
  if(!m)return "";
  const total=(Number(m[2])*60+Number(m[1])+540)%1440;
  return `${String(Math.floor(total/60)).padStart(2,"0")}:${String(total%60).padStart(2,"0")}`;
}
function kinSortTimes(a){return [...a].sort((x,y)=>x.localeCompare(y))}

async function kinReadWrangler(env){
  const c=githubConfig(env);
  const d=await githubApi(env,`/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/wrangler.jsonc?ref=${encodeURIComponent(c.branch)}`);
  const content=base64ToUtf8(d.content||"");
  return {config:JSON.parse(content),sha:d.sha,c};
}
async function kinUpdateSchedule(env,times){
  const good=times.map(x=>clean(x,5));
  if(good.length!==3||good.some(x=>!kinJstToCron(x))||new Set(good).size!==3)throw new Error("INVALID_SCHEDULE");
  const sorted=kinSortTimes(good);
  const {config,sha,c}=await kinReadWrangler(env);
  config.triggers={...(config.triggers||{}),crons:sorted.map(kinJstToCron)};
  config.vars={...(config.vars||{}),KIN_VERSION:"1.19",KIN_SCHEDULE_UPDATED_AT:new Date().toISOString()};
  const result=await githubApi(env,`/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/wrangler.jsonc`,{
    method:"PUT",headers:{"content-type":"application/json"},
    body:JSON.stringify({
      message:`admin: update auto discovery schedule ${sorted.join(" / ")} JST`,
      content:utf8ToBase64(JSON.stringify(config,null,2)+"\n"),
      sha,branch:c.branch
    })
  });
  return {ok:true,times_jst:sorted,crons:config.triggers.crons,commit_sha:result.commit?.sha||""};
}

async function kinScheduledMaintenance(env){
  const discovery=await kinAutoDiscover(env,{maxListings:5,pairLimit:5,perPairLimit:2});
  const missing=await kinRefreshMissing(env,{limit:20,afterId:0});
  const closed=await kinCheckClosed(env,{limit:20,afterId:0});
  await kinAlert(env,{
    type:"scheduled_summary",
    title:"予約メンテナンス完了",
    message:`新規掲載 ${discovery.created.length}店舗 / 情報補完 ${missing.updated.length}店舗 / 閉業候補 ${closed.closed.length}店舗`
  });
  return {discovery,missing,closed};
}

async function adminCount(env) {
  await ensureSchema(env);
  const r = await env.DB.prepare("SELECT COUNT(*) AS c FROM admins").first();
  return Number(r?.c || 0);
}


async function forceSetupOnceVer106(env) {
  await ensureSchema(env);
  const key = "force_setup_ver106";
  const done = await env.DB.prepare(
    "SELECT value FROM app_settings WHERE key=? LIMIT 1"
  ).bind(key).first();

  if (done) return false;

  // One transaction: clear only admin auth data and permanently mark migration complete.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM admin_sessions"),
    env.DB.prepare("DELETE FROM admins"),
    env.DB.prepare(
      "INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?)"
    ).bind(key, "done", nowIso())
  ]);
  return true;
}

function adminCookieToken(request) {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === "kin_admin_session") return decodeURIComponent(rest.join("="));
  }
  return "";
}

function setAdminCookie(token) {
  return `kin_admin_session=${encodeURIComponent(token)}; Path=/; Max-Age=${30*24*60*60}; HttpOnly; Secure; SameSite=Lax`;
}

function clearAdminCookie() {
  return "kin_admin_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax";
}

async function requireAdmin(request, env) {
  await ensureSchema(env);
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : adminCookieToken(request);
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const now = nowIso();
  const row = await env.DB.prepare(`
    SELECT a.id, a.email, s.expires_at
    FROM admin_sessions s
    JOIN admins a ON a.id=s.admin_id
    WHERE s.token_hash=? AND s.expires_at>?
    LIMIT 1
  `).bind(tokenHash, now).first();
  return row || null;
}

async function serveAsset(env, request, path) {
  const u = new URL(request.url);
  u.pathname = path;
  return env.ASSETS.fetch(new Request(u.toString(), request));
}

async function handleApi(request, env, url) {
  try {
    await ensureSchema(env);
    await ensureKinExtendedSchema(env);
  } catch (e) {
    return json({ok:false,error:"DB_NOT_READY",detail:String(e?.message||e)}, {status:503});
  }

  // ----- Admin setup/auth -----

  if (url.pathname === "/api/site-settings" && request.method === "GET") {
    await ensureSchema(env);
    const {results=[]}=await env.DB.prepare("SELECT setting_key,setting_value FROM site_settings").all();
    const settings={};
    for(const row of results) settings[row.setting_key]=row.setting_value;
    return json({ok:true,settings});
  }

  if (url.pathname === "/api/admin/status" && request.method === "GET") {
    const reset_applied = await forceSetupOnceVer106(env);
    const count = await adminCount(env);
    const me = await requireAdmin(request, env);
    return json({
      ok:true,
      version:"1.11",
      reset_applied,
      needs_setup: count===0,
      authenticated: !!me,
      admin: me ? {email:me.email}:null
    });
  }

  if (url.pathname === "/api/admin/bootstrap" && request.method === "POST") {
    try {
      if (await adminCount(env) > 0) return json({ok:false,error:"ALREADY_INITIALIZED"},{status:409});
      let x; try { x = await request.json(); } catch { return json({ok:false,error:"INVALID_JSON"},{status:400}); }
      const email = clean(x.email, 200).toLowerCase();
      const password = String(x.password || "");
      if (!email || !email.includes("@")) return json({ok:false,error:"EMAIL_REQUIRED"},{status:400});
      if (password.length < 8) return json({ok:false,error:"PASSWORD_TOO_SHORT"},{status:400});

      const salt = randomToken(16);
      const hash = await hashPassword(password, salt);
      const t = nowIso();

      await env.DB.prepare(
        "INSERT INTO admins(email,password_hash,password_salt,created_at) VALUES(?,?,?,?)"
      ).bind(email, hash, salt, t).run();

      return json({ok:true,version:"1.11"});
    } catch (e) {
      return json({
        ok:false,
        error:"BOOTSTRAP_FAILED",
        detail:String(e?.message || e),
        version:"1.11"
      }, {status:500});
    }
  }

  if (url.pathname === "/api/admin/login" && request.method === "POST") {
    let x; try { x = await request.json(); } catch { return json({ok:false,error:"INVALID_JSON"},{status:400}); }
    const email = clean(x.email, 200).toLowerCase();
    const password = String(x.password || "");
    const admin = await env.DB.prepare(
      "SELECT * FROM admins WHERE email=? LIMIT 1"
    ).bind(email).first();
    if (!admin) return json({ok:false,error:"INVALID_LOGIN"},{status:401});
    const hash = await hashPassword(password, admin.password_salt);
    if (!safeEqual(hash, admin.password_hash)) return json({ok:false,error:"INVALID_LOGIN"},{status:401});

    await env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at<=?").bind(nowIso()).run().catch(()=>{});
    const token = randomToken(32);
    const tokenHash = await hashToken(token);
    const expires = new Date(Date.now() + 30*24*60*60*1000).toISOString();
    await env.DB.prepare(`
      INSERT INTO admin_sessions(admin_id,token_hash,expires_at,created_at)
      VALUES(?,?,?,?)
    `).bind(admin.id, tokenHash, expires, nowIso()).run();
    return json({ok:true, token, expires_at:expires},{headers:{"set-cookie":setAdminCookie(token)}});
  }

  if (url.pathname === "/api/admin/logout" && request.method === "POST") {
    const auth = request.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : adminCookieToken(request);
    if (token) {
      const tokenHash = await hashToken(token);
      await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash=?").bind(tokenHash).run();
    }
    return json({ok:true},{headers:{"set-cookie":clearAdminCookie()}});
  }

  // ----- Public -----
  if (url.pathname === "/api/shops" && request.method === "GET") {
    const {results=[]} = await env.DB.prepare(`
      SELECT * FROM shops WHERE is_published=1
      ORDER BY updated_at DESC, id DESC
    `).all();
    return json({ok:true,shops:results.map(kinPublicShop)});
  }

  if (url.pathname === "/api/jobs" && request.method === "GET") {
    const {results=[]} = await env.DB.prepare(`
      SELECT j.*, s.name AS shop_name, s.slug AS shop_slug
      FROM jobs j
      LEFT JOIN shops s ON s.id=j.shop_id
      WHERE j.is_published=1
      ORDER BY j.updated_at DESC, j.id DESC
    `).all();
    return json({ok:true,jobs:results});
  }

  if (url.pathname === "/api/submissions" && request.method === "POST") {
    let x; try { x = await request.json(); } catch { return json({ok:false,error:"INVALID_JSON"},{status:400}); }
    const name = clean(x.shop_name, 160);
    if (!name) return json({ok:false,error:"SHOP_NAME_REQUIRED"},{status:400});
    await env.DB.prepare(`
      INSERT INTO submissions(
        shop_name,contact_name,email,phone,area,genre,address,hours,holiday,
        budget,instagram,features,description,wants_job,status,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      name, clean(x.contact_name,160), clean(x.email,220), clean(x.phone,100),
      clean(x.area,100), clean(x.genre,100), clean(x.address,300),
      clean(x.hours,180), clean(x.holiday,120), clean(x.budget,120),
      clean(x.instagram,300), clean(x.features,1000), clean(x.description,5000),
      bool(x.wants_job), "pending", nowIso()
    ).run();
    return json({ok:true},{status:201});
  }

  if (url.pathname === "/api/admin/version" && request.method === "GET") {
    return json({ok:true,version:"1.19",admin_setup_fix:true,d1_schema_fix:true,bar_parity:true});
  }


  const kinAnalytics=url.pathname.match(/^\/api\/analytics\/([^/]+)$/);
  if(kinAnalytics && request.method==="POST"){
    let x={};try{x=await request.json()}catch{}
    const action=clean(x.action,30);
    if(!["view","instagram","map","phone","website"].includes(action))return json({ok:false,error:"INVALID_ACTION"},{status:400});
    const shop=await env.DB.prepare("SELECT id FROM shops WHERE slug=? AND is_published=1 LIMIT 1").bind(decodeURIComponent(kinAnalytics[1])).first();
    if(!shop)return json({ok:false,error:"NOT_FOUND"},{status:404});
    await env.DB.prepare("INSERT INTO shop_analytics(shop_id,action,created_at) VALUES(?,?,?)").bind(shop.id,action,nowIso()).run();
    return json({ok:true});
  }

  // everything below requires admin
  if (!url.pathname.startsWith("/api/admin/")) return json({ok:false,error:"NOT_FOUND"},{status:404});
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ok:false,error:"UNAUTHORIZED"},{status:401});

  // ----- Admin shops -----
  if (url.pathname === "/api/admin/shops" && request.method === "GET") {
    const {results=[]} = await env.DB.prepare(`
      SELECT * FROM shops ORDER BY updated_at DESC, id DESC
    `).all();
    return json({ok:true,shops:results.map(x=>({...x,features:parseFeatures(x.features)}))});
  }

  if (url.pathname === "/api/admin/shops" && request.method === "POST") {
    let x; try { x=await request.json(); } catch { return json({ok:false,error:"INVALID_JSON"},{status:400}); }
    const name = clean(x.name,160);
    if (!name) return json({ok:false,error:"NAME_REQUIRED"},{status:400});
    let slug = clean(x.slug,120) || slugify(name);
    const exists = await env.DB.prepare("SELECT id FROM shops WHERE slug=?").bind(slug).first();
    if (exists) slug = `${slug}-${Date.now().toString(36)}`;
    const t = nowIso();
    const r = await env.DB.prepare(`
      INSERT INTO shops(slug,name,area,genre,address,hours,holiday,budget,phone,instagram,features,description,is_published,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      slug,name,clean(x.area,100),clean(x.genre,100),clean(x.address,300),
      clean(x.hours,180),clean(x.holiday,120),clean(x.budget,120),
      clean(x.phone,100),clean(x.instagram,300),featuresJson(x.features),
      clean(x.description,5000),bool(x.is_published),t,t
    ).run();
    {
      const id=Number(r.meta?.last_row_id||0);
      await env.DB.prepare(`
        UPDATE shops SET listing_status=?,published_at=?,is_new=1,sort_order=100,
          budget_min=?,budget_max=?,seats=?,is_featured=?,business_status='OPERATIONAL'
        WHERE id=?
      `).bind(
        kinListingStatus(x.listing_status),
        bool(x.is_published)?t:"",
        x.budget_min===""||x.budget_min==null?null:Number(x.budget_min),
        x.budget_max===""||x.budget_max==null?null:Number(x.budget_max),
        x.seats===""||x.seats==null?null:Number(x.seats),
        bool(x.is_featured),id
      ).run();
      return json({ok:true,id,slug},{status:201});
    }
  }

  const shopMatch = url.pathname.match(/^\/api\/admin\/shops\/(\d+)$/);
  if (shopMatch && request.method === "PATCH") {
    let x; try { x=await request.json(); } catch { return json({ok:false,error:"INVALID_JSON"},{status:400}); }
    const id = Number(shopMatch[1]);
    const current = await env.DB.prepare("SELECT * FROM shops WHERE id=?").bind(id).first();
    if (!current) return json({ok:false,error:"NOT_FOUND"},{status:404});
    const name = clean(x.name ?? current.name,160);
    const slug = clean(x.slug ?? current.slug,120) || current.slug;
    await env.DB.prepare(`
      UPDATE shops SET
        slug=?,name=?,area=?,genre=?,address=?,hours=?,holiday=?,budget=?,phone=?,instagram=?,
        features=?,description=?,is_published=?,updated_at=?
      WHERE id=?
    `).bind(
      slug,name,
      clean(x.area ?? current.area,100),clean(x.genre ?? current.genre,100),
      clean(x.address ?? current.address,300),clean(x.hours ?? current.hours,180),
      clean(x.holiday ?? current.holiday,120),clean(x.budget ?? current.budget,120),
      clean(x.phone ?? current.phone,100),clean(x.instagram ?? current.instagram,300),
      featuresJson(x.features ?? current.features),
      clean(x.description ?? current.description,5000),
      x.is_published === undefined ? Number(current.is_published||0) : bool(x.is_published),
      nowIso(),id
    ).run();
    return json({ok:true});
  }

  if (shopMatch && request.method === "DELETE") {
    const id = Number(shopMatch[1]);
    await env.DB.prepare("DELETE FROM jobs WHERE shop_id=?").bind(id).run().catch(()=>{});
    await env.DB.prepare("DELETE FROM shops WHERE id=?").bind(id).run();
    return json({ok:true});
  }

  // ----- Admin submissions -----
  if (url.pathname === "/api/admin/submissions" && request.method === "GET") {
    const {results=[]} = await env.DB.prepare(`
      SELECT * FROM submissions
      ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC
    `).all();
    return json({ok:true,submissions:results});
  }

  const approve = url.pathname.match(/^\/api\/admin\/submissions\/(\d+)\/approve$/);
  if (approve && request.method === "POST") {
    const id = Number(approve[1]);
    const s = await env.DB.prepare("SELECT * FROM submissions WHERE id=?").bind(id).first();
    if (!s) return json({ok:false,error:"NOT_FOUND"},{status:404});
    if (s.status === "approved") return json({ok:false,error:"ALREADY_APPROVED"},{status:409});

    let slug = slugify(s.shop_name);
    const exists = await env.DB.prepare("SELECT id FROM shops WHERE slug=?").bind(slug).first();
    if (exists) slug += `-${Date.now().toString(36)}`;
    const t = nowIso();
    const r = await env.DB.prepare(`
      INSERT INTO shops(slug,name,area,genre,address,hours,holiday,budget,phone,instagram,features,description,is_published,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      slug,s.shop_name,s.area||"",s.genre||"",s.address||"",s.hours||"",s.holiday||"",
      s.budget||"",s.phone||"",s.instagram||"",featuresJson(s.features||""),
      s.description||"",1,t,t
    ).run();

    await env.DB.prepare(
      "UPDATE submissions SET status='approved',reviewed_at=? WHERE id=?"
    ).bind(t,id).run();
    return json({ok:true,shop_id:r.meta?.last_row_id,slug});
  }

  const reject = url.pathname.match(/^\/api\/admin\/submissions\/(\d+)\/reject$/);
  if (reject && request.method === "POST") {
    await env.DB.prepare(
      "UPDATE submissions SET status='rejected',reviewed_at=? WHERE id=?"
    ).bind(nowIso(), Number(reject[1])).run();
    return json({ok:true});
  }




  if (url.pathname === "/api/admin/site-settings" && request.method === "GET") {
    const {results=[]}=await env.DB.prepare("SELECT setting_key,setting_value FROM site_settings").all();
    const settings={};
    for(const row of results) settings[row.setting_key]=row.setting_value;
    return json({ok:true,settings});
  }

  if (url.pathname === "/api/admin/site-settings" && request.method === "PUT") {
    let x;try{x=await request.json()}catch{return json({ok:false,error:"INVALID_JSON"},{status:400})}
    const allowed=["hero_title","hero_subtitle","notice_title","notice_text","cta_title","cta_text"];
    const t=nowIso();
    const stmts=[];
    for(const key of allowed){
      if(Object.prototype.hasOwnProperty.call(x,key)){
        stmts.push(env.DB.prepare(`
          INSERT INTO site_settings(setting_key,setting_value,updated_at) VALUES(?,?,?)
          ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=excluded.updated_at
        `).bind(key,String(x[key]??"").slice(0,3000),t));
      }
    }
    if(stmts.length)await env.DB.batch(stmts);
    return json({ok:true});
  }

  // ----- GitHub site editor -----
  if (url.pathname === "/api/admin/github/status" && request.method === "GET") {
    const c = githubConfig(env);
    if (!c.token) {
      return json({
        ok:true,
        configured:false,
        owner:c.owner,repo:c.repo,branch:c.branch,
        editable_files:[...GITHUB_EDITABLE_FILES]
      });
    }
    try {
      const repo = await githubApi(env, `/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`);
      return json({
        ok:true,configured:true,connected:true,
        owner:c.owner,repo:c.repo,branch:c.branch,
        repo_url:repo.html_url||"",
        editable_files:[...GITHUB_EDITABLE_FILES]
      });
    } catch(e) {
      return json({
        ok:true,configured:true,connected:false,
        owner:c.owner,repo:c.repo,branch:c.branch,
        error:e.message
      });
    }
  }

  if (url.pathname === "/api/admin/github/file" && request.method === "GET") {
    const c = githubConfig(env);
    const path = clean(url.searchParams.get("path"), 180);
    if (!GITHUB_EDITABLE_FILES.has(path)) return json({ok:false,error:"FILE_NOT_ALLOWED"},{status:400});
    try {
      const d = await githubApi(
        env,
        `/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(c.branch)}`
      );
      if (Array.isArray(d) || d.type !== "file") return json({ok:false,error:"NOT_A_FILE"},{status:400});
      return json({
        ok:true,path,sha:d.sha,size:d.size,
        content:base64ToUtf8(d.content||""),
        html_url:d.html_url||""
      });
    } catch(e) {
      return json({ok:false,error:"GITHUB_READ_FAILED",detail:e.message},{status:e.status||502});
    }
  }

  if (url.pathname === "/api/admin/github/file" && request.method === "PUT") {
    const c = githubConfig(env);
    let x; try{x=await request.json()}catch{return json({ok:false,error:"INVALID_JSON"},{status:400})}
    const path=clean(x.path,180);
    const content=String(x.content??"");
    const sha=clean(x.sha,100);
    const message=clean(x.message,180)||`KBN admin: update ${path}`;
    const confirmText=clean(x.confirm,50);

    if(!GITHUB_EDITABLE_FILES.has(path))return json({ok:false,error:"FILE_NOT_ALLOWED"},{status:400});
    if(confirmText!=="GITHUBへ反映")return json({ok:false,error:"CONFIRM_REQUIRED"},{status:400});
    if(!sha)return json({ok:false,error:"SHA_REQUIRED"},{status:400});
    if(content.length>900000)return json({ok:false,error:"FILE_TOO_LARGE"},{status:413});

    try{
      const result=await githubApi(
        env,
        `/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${encodeURIComponent(path)}`,
        {
          method:"PUT",
          headers:{"content-type":"application/json"},
          body:JSON.stringify({
            message,
            content:utf8ToBase64(content),
            sha,
            branch:c.branch
          })
        }
      );

      return json({
        ok:true,path,
        commit_sha:result.commit?.sha||"",
        commit_url:result.commit?.html_url||"",
        file_url:result.content?.html_url||"",
        message:"GitHubへ反映しました。Cloudflareの自動デプロイが開始されます。"
      });
    }catch(e){
      return json({
        ok:false,error:"GITHUB_UPDATE_FAILED",detail:e.message,
        github_status:e.status||null
      },{status:e.status||502});
    }
  }

  // ----- Admin jobs -----
  if (url.pathname === "/api/admin/jobs" && request.method === "GET") {
    const {results=[]} = await env.DB.prepare(`
      SELECT j.*, s.name AS shop_name
      FROM jobs j LEFT JOIN shops s ON s.id=j.shop_id
      ORDER BY j.updated_at DESC, j.id DESC
    `).all();
    return json({ok:true,jobs:results});
  }

  if (url.pathname === "/api/admin/jobs" && request.method === "POST") {
    let x; try{x=await request.json()}catch{return json({ok:false,error:"INVALID_JSON"},{status:400})}
    const title=clean(x.title,180);
    if(!title)return json({ok:false,error:"TITLE_REQUIRED"},{status:400});
    const t=nowIso();
    const r=await env.DB.prepare(`
      INSERT INTO jobs(shop_id,title,salary,employment_type,description,is_published,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?)
    `).bind(
      x.shop_id?Number(x.shop_id):null,title,clean(x.salary,120),clean(x.employment_type,100),
      clean(x.description,5000),bool(x.is_published),t,t
    ).run();
    return json({ok:true,id:r.meta?.last_row_id},{status:201});
  }

  const jobMatch=url.pathname.match(/^\/api\/admin\/jobs\/(\d+)$/);
  if(jobMatch && request.method==="PATCH"){
    const id=Number(jobMatch[1]);
    const cur=await env.DB.prepare("SELECT * FROM jobs WHERE id=?").bind(id).first();
    if(!cur)return json({ok:false,error:"NOT_FOUND"},{status:404});
    let x; try{x=await request.json()}catch{return json({ok:false,error:"INVALID_JSON"},{status:400})}
    await env.DB.prepare(`
      UPDATE jobs SET shop_id=?,title=?,salary=?,employment_type=?,description=?,is_published=?,updated_at=? WHERE id=?
    `).bind(
      x.shop_id===undefined?cur.shop_id:(x.shop_id?Number(x.shop_id):null),
      clean(x.title??cur.title,180),clean(x.salary??cur.salary,120),
      clean(x.employment_type??cur.employment_type,100),clean(x.description??cur.description,5000),
      x.is_published===undefined?Number(cur.is_published||0):bool(x.is_published),nowIso(),id
    ).run();
    return json({ok:true});
  }
  if(jobMatch && request.method==="DELETE"){
    await env.DB.prepare("DELETE FROM jobs WHERE id=?").bind(Number(jobMatch[1])).run();
    return json({ok:true});
  }

  // ----- Lead / prospecting -----
  if (url.pathname === "/api/admin/leads" && request.method === "GET") {
    const {results=[]}=await env.DB.prepare(`
      SELECT * FROM lead_candidates
      ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'contacted' THEN 1 ELSE 2 END, id DESC
    `).all();
    return json({ok:true,leads:results});
  }

  if (url.pathname === "/api/admin/leads" && request.method === "POST") {
    let x;try{x=await request.json()}catch{return json({ok:false,error:"INVALID_JSON"},{status:400})}
    const name=clean(x.name,180);
    if(!name)return json({ok:false,error:"NAME_REQUIRED"},{status:400});
    const t=nowIso();
    const r=await env.DB.prepare(`
      INSERT INTO lead_candidates(name,area,genre,address,source_url,instagram,phone,snippet,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      name,clean(x.area,100),clean(x.genre,100),clean(x.address,300),clean(x.source_url,600),
      clean(x.instagram,300),clean(x.phone,100),clean(x.snippet,2000),clean(x.status||"new",30),t,t
    ).run();
    return json({ok:true,id:r.meta?.last_row_id},{status:201});
  }

  const leadMatch=url.pathname.match(/^\/api\/admin\/leads\/(\d+)$/);
  if(leadMatch && request.method==="PATCH"){
    const id=Number(leadMatch[1]);
    const cur=await env.DB.prepare("SELECT * FROM lead_candidates WHERE id=?").bind(id).first();
    if(!cur)return json({ok:false,error:"NOT_FOUND"},{status:404});
    let x;try{x=await request.json()}catch{return json({ok:false,error:"INVALID_JSON"},{status:400})}
    await env.DB.prepare(`
      UPDATE lead_candidates SET name=?,area=?,genre=?,address=?,source_url=?,instagram=?,phone=?,snippet=?,status=?,updated_at=? WHERE id=?
    `).bind(
      clean(x.name??cur.name,180),clean(x.area??cur.area,100),clean(x.genre??cur.genre,100),
      clean(x.address??cur.address,300),clean(x.source_url??cur.source_url,600),
      clean(x.instagram??cur.instagram,300),clean(x.phone??cur.phone,100),
      clean(x.snippet??cur.snippet,2000),clean(x.status??cur.status,30),nowIso(),id
    ).run();
    return json({ok:true});
  }
  if(leadMatch && request.method==="DELETE"){
    await env.DB.prepare("DELETE FROM lead_candidates WHERE id=?").bind(Number(leadMatch[1])).run();
    return json({ok:true});
  }

  if (url.pathname === "/api/admin/lead-search" && request.method === "POST") {
    let x;try{x=await request.json()}catch{return json({ok:false,error:"INVALID_JSON"},{status:400})}
    const area=clean(x.area,100)||"熊本市";
    const keyword=clean(x.keyword,120)||"居酒屋";
    if(!env.SERPAPI_API_KEY){
      return json({ok:false,error:"SERPAPI_KEY_MISSING",message:"SerpApiキー未設定。手動候補登録は利用できます。"},{status:503});
    }

    const q=`${area} ${keyword} Instagram`;
    const apiUrl=new URL("https://serpapi.com/search.json");
    apiUrl.searchParams.set("engine","google");
    apiUrl.searchParams.set("q",q);
    apiUrl.searchParams.set("hl","ja");
    apiUrl.searchParams.set("gl","jp");
    apiUrl.searchParams.set("num","10");
    apiUrl.searchParams.set("api_key",env.SERPAPI_API_KEY);

    const rr=await fetch(apiUrl.toString());
    if(!rr.ok)return json({ok:false,error:"SERPAPI_FAILED",status:rr.status},{status:502});
    const d=await rr.json();
    const items=(d.organic_results||[]).slice(0,10).map(r=>({
      name:clean(r.title,180),
      area,
      genre:keyword,
      address:"",
      source_url:clean(r.link,600),
      snippet:clean(r.snippet,1500)
    })).filter(x=>x.name);

    let added=0;
    for(const item of items){
      const dup=await env.DB.prepare(
        "SELECT id FROM lead_candidates WHERE name=? AND source_url=? LIMIT 1"
      ).bind(item.name,item.source_url).first();
      if(dup)continue;
      const t=nowIso();
      await env.DB.prepare(`
        INSERT INTO lead_candidates(name,area,genre,address,source_url,instagram,phone,snippet,status,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)
      `).bind(item.name,item.area,item.genre,item.address,item.source_url,"","",item.snippet,"new",t,t).run();
      added++;
    }
    return json({ok:true,found:items.length,added});
  }


  // ----- BAR NAVI parity: automatic discovery / maintenance -----
  if (url.pathname === "/api/admin/leads/auto-discover" && request.method === "POST") {
    let x={};try{x=await request.json()}catch{}
    const d=await kinAutoDiscover(env,{
      maxListings:Math.max(1,Math.min(Number(x.max_listings)||12,25)),
      pairLimit:Math.max(1,Math.min(Number(x.pair_limit)||8,16)),
      perPairLimit:Math.max(1,Math.min(Number(x.per_pair_limit)||3,8))
    });
    return json(d);
  }

  if (url.pathname === "/api/admin/leads/auto-listed" && request.method === "GET") {
    const r=await env.DB.prepare(`
      SELECT * FROM shops
      WHERE COALESCE(listing_status,'published')='provisional'
      ORDER BY id DESC LIMIT 300
    `).all();
    return json({ok:true,shops:(r.results||[]).map(x=>({...x,features:parseFeatures(x.features)}))});
  }

  const autoAction=url.pathname.match(/^\/api\/admin\/leads\/auto-listed\/(\d+)\/(unpublish|restore)$/);
  if(autoAction && request.method==="POST"){
    const id=Number(autoAction[1]),action=autoAction[2];
    await env.DB.prepare("UPDATE shops SET is_published=?,updated_at=? WHERE id=? AND COALESCE(listing_status,'published')='provisional'")
      .bind(action==="restore"?1:0,nowIso(),id).run();
    return json({ok:true,id,is_published:action==="restore"?1:0});
  }

  if (url.pathname === "/api/admin/leads/refresh-missing" && request.method === "POST") {
    let x={};try{x=await request.json()}catch{}
    return json(await kinRefreshMissing(env,{limit:x.limit,afterId:x.after_id}));
  }

  if (url.pathname === "/api/admin/leads/refresh-instagram" && request.method === "POST") {
    let x={};try{x=await request.json()}catch{}
    const limit=Math.max(1,Math.min(Number(x.limit)||20,40)),after=Number(x.after_id)||0;
    const r=await env.DB.prepare(`
      SELECT * FROM shops
      WHERE COALESCE(listing_status,'published')='provisional'
        AND COALESCE(TRIM(instagram),'')='' AND id>?
      ORDER BY id ASC LIMIT ?
    `).bind(after,limit).all();
    const updated=[],candidates=[],failed=[];
    for(const s of (r.results||[])){
      try{
        let website=s.website||"";
        if(!website){
          const f=await kinFindGoogleShop(env,s.name,s.area);
          if(f.matched){
            const d=await kinGoogleDetails(env,f.place.id);
            website=kinWebsite(d.ok?d.place:f.place);
          }
        }
        const ig=await kinInstagramSearch(env,{name:s.name,area:s.area,website});
        if(ig.instagram&&ig.score>=90){
          await env.DB.prepare("UPDATE shops SET instagram=?,website=?,updated_at=? WHERE id=?")
            .bind(ig.instagram,website,nowIso(),s.id).run();
          updated.push({id:s.id,name:s.name,instagram:ig.instagram,score:ig.score});
        }else if(ig.candidate&&ig.candidate.score>=70){
          candidates.push({id:s.id,name:s.name,score:ig.candidate.score,instagram:ig.candidate.instagram});
        }
      }catch(e){failed.push({id:s.id,name:s.name,error:String(e?.message||e).slice(0,180)})}
    }
    const rows=r.results||[],next=rows.length?Number(rows[rows.length-1].id):after;
    const more=await env.DB.prepare(`
      SELECT id FROM shops WHERE COALESCE(listing_status,'published')='provisional'
      AND COALESCE(TRIM(instagram),'')='' AND id>? ORDER BY id ASC LIMIT 1
    `).bind(next).first();
    return json({ok:true,checked:rows.length,updated,candidates,failed,next_after_id:next,has_more:!!more});
  }

  if (url.pathname === "/api/admin/leads/check-closed" && request.method === "POST") {
    let x={};try{x=await request.json()}catch{}
    return json(await kinCheckClosed(env,{limit:x.limit,afterId:x.after_id}));
  }

  if (url.pathname === "/api/admin/alerts" && request.method === "GET") {
    const r=await env.DB.prepare("SELECT * FROM kin_admin_alerts ORDER BY id DESC LIMIT 60").all();
    return json({ok:true,alerts:r.results||[],unread:(r.results||[]).filter(x=>!Number(x.is_read)).length});
  }

  const alertRead=url.pathname.match(/^\/api\/admin\/alerts\/(\d+)\/read$/);
  if(alertRead && request.method==="POST"){
    await env.DB.prepare("UPDATE kin_admin_alerts SET is_read=1 WHERE id=?").bind(Number(alertRead[1])).run();
    return json({ok:true});
  }

  const maint=url.pathname.match(/^\/api\/admin\/shops\/(\d+)\/maintenance-action$/);
  if(maint && request.method==="POST"){
    let x={};try{x=await request.json()}catch{}
    const id=Number(maint[1]),action=String(x.action||"");
    if(action==="operational"){
      await env.DB.prepare("UPDATE shops SET business_status='OPERATIONAL',is_published=1,updated_at=? WHERE id=?").bind(nowIso(),id).run();
    }else if(action==="temporary_closed"){
      await env.DB.prepare("UPDATE shops SET business_status='CLOSED_TEMPORARILY',is_published=1,updated_at=? WHERE id=?").bind(nowIso(),id).run();
    }else if(action==="unpublish"){
      await env.DB.prepare("UPDATE shops SET business_status='UNPUBLISHED',is_published=0,updated_at=? WHERE id=?").bind(nowIso(),id).run();
    }else return json({ok:false,error:"INVALID_ACTION"},{status:400});
    await env.DB.prepare("UPDATE kin_admin_alerts SET is_read=1 WHERE shop_id=? AND alert_type='closed_shop'").bind(id).run();
    return json({ok:true});
  }

  if (url.pathname === "/api/admin/auto-schedule" && request.method === "GET") {
    try{
      const {config}=await kinReadWrangler(env);
      const times=kinSortTimes((config?.triggers?.crons||[]).map(kinCronToJst).filter(Boolean));
      return json({ok:true,timezone:"Asia/Tokyo",times_jst:times,crons:config?.triggers?.crons||[]});
    }catch(e){return json({ok:false,error:"SCHEDULE_READ_FAILED",message:String(e?.message||e)},{status:502})}
  }

  if (url.pathname === "/api/admin/auto-schedule" && request.method === "PUT") {
    let x={};try{x=await request.json()}catch{return json({ok:false,error:"INVALID_JSON"},{status:400})}
    try{return json(await kinUpdateSchedule(env,Array.isArray(x.times_jst)?x.times_jst:[]))}
    catch(e){return json({ok:false,error:"SCHEDULE_UPDATE_FAILED",message:String(e?.message||e)},{status:400})}
  }

  if (url.pathname === "/api/admin/access-summary" && request.method === "GET") {
    const shopCount=await env.DB.prepare("SELECT COUNT(*) c FROM shops").first();
    const pubCount=await env.DB.prepare("SELECT COUNT(*) c FROM shops WHERE is_published=1").first();
    const jobCount=await env.DB.prepare("SELECT COUNT(*) c FROM jobs WHERE is_published=1").first();
    const leadCount=await env.DB.prepare("SELECT COUNT(*) c FROM lead_candidates WHERE status='new'").first();
    return json({ok:true,summary:{
      shops:Number(shopCount?.c||0),published:Number(pubCount?.c||0),
      jobs:Number(jobCount?.c||0),new_leads:Number(leadCount?.c||0)
    }});
  }

  return json({ok:false,error:"NOT_FOUND"},{status:404});
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, url);
    }

    if (url.pathname === "/admin-login" || url.pathname === "/admin-login/") {
      if (await requireAdmin(request, env)) {
        return Response.redirect(new URL("/admin", request.url).toString(), 302);
      }
      const r = await serveAsset(env, request, "/admin-login.html");
      const h = new Headers(r.headers);
      h.set("Cache-Control","no-store, no-cache, must-revalidate, max-age=0");
      h.set("Pragma","no-cache");
      return new Response(r.body,{status:r.status,statusText:r.statusText,headers:h});
    }
    if (url.pathname === "/admin" || url.pathname === "/admin/") {
      if (!(await requireAdmin(request, env))) {
        return Response.redirect(new URL("/admin-login", request.url).toString(), 302);
      }
      const r = await serveAsset(env, request, "/admin.html");
      const h = new Headers(r.headers);
      h.set("Cache-Control","no-store, no-cache, must-revalidate, max-age=0");
      h.set("Pragma","no-cache");
      return new Response(r.body,{status:r.status,statusText:r.statusText,headers:h});
    }
    if (url.pathname === "/db-status") {
      try {
        await ensureSchema(env);
        return json({ok:true,db:true,admins:await adminCount(env)});
      } catch (e) {
        return json({ok:false,db:false,error:String(e?.message||e)},{status:503});
      }
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      kinScheduledMaintenance(env).catch(e=>console.error("KIN scheduled maintenance failed",e))
    );
  }
};
