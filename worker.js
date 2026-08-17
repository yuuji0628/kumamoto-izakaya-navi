
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

async function requireAdmin(request, env) {
  await ensureSchema(env);
  const auth = request.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
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
  } catch (e) {
    return json({ok:false,error:"DB_NOT_READY",detail:String(e?.message||e)}, {status:503});
  }

  // ----- Admin setup/auth -----
  if (url.pathname === "/api/admin/status" && request.method === "GET") {
    const reset_applied = await forceSetupOnceVer106(env);
    const count = await adminCount(env);
    const me = await requireAdmin(request, env);
    return json({
      ok:true,
      version:"1.09",
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

      return json({ok:true,version:"1.09"});
    } catch (e) {
      return json({
        ok:false,
        error:"BOOTSTRAP_FAILED",
        detail:String(e?.message || e),
        version:"1.09"
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
    return json({ok:true, token, expires_at:expires});
  }

  if (url.pathname === "/api/admin/logout" && request.method === "POST") {
    const auth = request.headers.get("authorization") || "";
    if (auth.startsWith("Bearer ")) {
      const tokenHash = await hashToken(auth.slice(7).trim());
      await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash=?").bind(tokenHash).run();
    }
    return json({ok:true});
  }

  // ----- Public -----
  if (url.pathname === "/api/shops" && request.method === "GET") {
    const {results=[]} = await env.DB.prepare(`
      SELECT * FROM shops WHERE is_published=1
      ORDER BY updated_at DESC, id DESC
    `).all();
    return json({ok:true,shops:results.map(rowShop)});
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
    return json({ok:true,version:"1.09",admin_setup_fix:true,d1_schema_fix:true});
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
    return json({ok:true,shops:results.map(rowShop)});
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
    return json({ok:true,id:r.meta?.last_row_id,slug},{status:201});
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

  return json({ok:false,error:"NOT_FOUND"},{status:404});
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, url);
    }

    if (url.pathname === "/admin-login" || url.pathname === "/admin-login/") {
      return serveAsset(env, request, "/admin-login.html");
    }
    if (url.pathname === "/admin" || url.pathname === "/admin/") {
      return serveAsset(env, request, "/admin.html");
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
  }
};
