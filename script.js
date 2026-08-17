
const KIN_AREAS=["熊本市", "八代市", "人吉市", "荒尾市", "水俣市", "玉名市", "山鹿市", "菊池市", "宇土市", "上天草市", "宇城市", "阿蘇市", "天草市", "合志市", "美里町", "玉東町", "南関町", "長洲町", "和水町", "大津町", "菊陽町", "南小国町", "小国町", "産山村", "高森町", "西原村", "南阿蘇村", "御船町", "嘉島町", "益城町", "甲佐町", "山都町", "氷川町", "芦北町", "津奈木町", "錦町", "多良木町", "湯前町", "水上村", "相良村", "五木村", "山江村", "球磨村", "あさぎり町", "苓北町"];
const DEMO_SHOPS=[
  {id:1,slug:"demo-sakura",name:"【デモ】酒場 さくら",area:"熊本市",genre:"郷土料理",budget:"3,000〜5,000円",hours:"17:00〜24:00",holiday:"不定休",features:["馬刺し","個室","飲み放題"],description:"熊本の郷土料理と地酒を楽しめる店舗の表示サンプルです。",published_at:"2026-08-17"},
  {id:2,slug:"demo-umi",name:"【デモ】海鮮酒場 うみ",area:"八代市",genre:"海鮮",budget:"3,000〜4,000円",hours:"18:00〜翌1:00",holiday:"火曜日",features:["海鮮","宴会","カウンター"],description:"鮮魚と焼酎を楽しめる店舗の表示サンプルです。",published_at:"2026-08-16"},
  {id:3,slug:"demo-tori",name:"【デモ】炭火やきとり 火乃",area:"宇城市",genre:"焼き鳥",budget:"2,500〜4,000円",hours:"17:30〜23:30",holiday:"水曜日",features:["焼き鳥","飲み放題","一人飲み"],description:"炭火焼き鳥を中心にした店舗の表示サンプルです。",published_at:"2026-08-15"}
];

function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
async function getShops(){
  try{
    const r=await fetch("/api/shops",{cache:"no-store"});
    if(r.ok){
      const d=await r.json();
      if(d.ok)return d.shops||d.results||[];
    }
  }catch(e){}
  return DEMO_SHOPS;
}
function card(s){
  return `<a class="shop-card" href="shop.html?slug=${encodeURIComponent(s.slug||s.id)}">
    <div class="shop-photo">🏮</div><div class="shop-body">
    <div class="shop-meta">${esc(s.area||"熊本県")} / ${esc(s.genre||"居酒屋")}</div>
    <h3 class="shop-name">${esc(s.name)}</h3><p class="shop-desc">${esc(s.description||"店舗情報を掲載しています。")}</p>
    <div class="badges">${(s.features||[]).slice(0,3).map(x=>`<span class="badge">${esc(x)}</span>`).join("")}</div></div></a>`;
}
async function home(){
 const box=document.getElementById("homeShops"); if(!box)return; const shops=await getShops();
 box.innerHTML=shops.slice(0,3).map(card).join("");
 const news=document.getElementById("homeNews");
 if(news)news.innerHTML=shops.slice(0,4).map((s,i)=>`<a class="news-item" href="shop.html?slug=${encodeURIComponent(s.slug||s.id)}"><time>${i===0?"NEW":"8/"+(16-i)}</time><div><b>${esc(s.name)} を掲載しました</b><small>${esc(s.area||"熊本県")}の店舗情報を公開しました。</small></div><span>›</span></a>`).join("");
}
async function listShops(){
 const box=document.getElementById("shopList"); if(!box)return; const shops=await getShops();
 const p=new URLSearchParams(location.search), area=p.get("area")||"", genre=p.get("genre")||"", feature=p.get("feature")||"", q=(p.get("q")||"").toLowerCase();
 const form=document.getElementById("shopFilter"); if(form){form.area.value=area;form.genre.value=genre;form.q.value=p.get("q")||""}
 const rows=shops.filter(s=>(!area||s.area===area)&&(!genre||s.genre===genre)&&(!feature||(s.features||[]).includes(feature))&&(!q||JSON.stringify(s).toLowerCase().includes(q)));
 document.getElementById("shopCount").textContent=`${rows.length}件の居酒屋`;
 box.innerHTML=rows.length?rows.map(s=>`<a class="list-shop" href="shop.html?slug=${encodeURIComponent(s.slug||s.id)}"><div class="thumb">🏮</div><div><p>${esc(s.area)} / ${esc(s.genre)}</p><h3>${esc(s.name)}</h3><p>${esc(s.budget||"料金情報準備中")}　${esc(s.hours||"")}</p><div class="badges">${(s.features||[]).slice(0,3).map(x=>`<span class="badge">${esc(x)}</span>`).join("")}</div></div><span class="go">›</span></a>`).join(""):`<div class="empty">条件に合う居酒屋はまだありません。</div>`;
}
async function detail(){
 const box=document.getElementById("shopDetail");if(!box)return;const shops=await getShops();const slug=new URLSearchParams(location.search).get("slug");
 const s=shops.find(x=>String(x.slug||x.id)===String(slug))||shops[0];
 box.innerHTML=`<div class="detail-grid"><div class="detail-photo">🏮</div><div class="detail-card"><p class="kicker">${esc(s.area)} / ${esc(s.genre)}</p><h1>${esc(s.name)}</h1><p style="color:#a3aeb8">${esc(s.description||"")}</p>
 <div class="detail-row"><span>エリア</span><b>${esc(s.area||"-")}</b></div><div class="detail-row"><span>ジャンル</span><b>${esc(s.genre||"-")}</b></div>
 <div class="detail-row"><span>営業時間</span><b>${esc(s.hours||"-")}</b></div><div class="detail-row"><span>定休日</span><b>${esc(s.holiday||"-")}</b></div>
 <div class="detail-row"><span>料金目安</span><b>${esc(s.budget||"-")}</b></div>
 <div class="badges">${(s.features||[]).map(x=>`<span class="badge gold">${esc(x)}</span>`).join("")}</div>
 <div class="detail-actions"><a class="gold-btn" href="izakayas.html?area=${encodeURIComponent(s.area||"")}">周辺の居酒屋を見る</a><a class="ghost-btn" href="index.html">ホーム</a></div></div></div>`;
}
function setupForms(){
 const hs=document.getElementById("homeSearch");if(hs)hs.addEventListener("submit",e=>{e.preventDefault();const f=new FormData(hs),p=new URLSearchParams();for(const [k,v] of f)if(v)p.set(k,v);location.href="izakayas.html?"+p});
 const sf=document.getElementById("shopFilter");if(sf)sf.addEventListener("submit",e=>{e.preventDefault();const f=new FormData(sf),p=new URLSearchParams();for(const [k,v] of f)if(v)p.set(k,v);location.href="izakayas.html?"+p});
 const lf=document.getElementById("listingForm");if(lf)lf.addEventListener("submit",async e=>{e.preventDefault();const btn=lf.querySelector('button[type="submit"]');const data=Object.fromEntries(new FormData(lf));delete data.photo;btn.disabled=true;btn.textContent="送信中...";try{const r=await fetch("/api/submissions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(data)});const d=await r.json();if(!r.ok||!d.ok)throw new Error();document.getElementById("formResult").innerHTML='<div style="margin-top:16px;padding:14px;border:1px solid #3d6c50;border-radius:12px;color:#83d19f">掲載申込みを受け付けました。内容を確認後、掲載準備を進めます。</div>';lf.reset()}catch{document.getElementById("formResult").innerHTML='<div style="margin-top:16px;padding:14px;border:1px solid #6b3d3d;border-radius:12px;color:#e69595">送信に失敗しました。時間をおいてもう一度お試しください。</div>'}finally{btn.disabled=false;btn.textContent="掲載申込みを送信"}window.scrollTo({top:document.body.scrollHeight,behavior:"smooth"})});
}
async function jobs(){
 const box=document.getElementById("jobList");if(!box)return;
 try{const r=await fetch("/api/jobs");if(r.ok){const d=await r.json(),a=d.jobs||[];if(a.length){box.innerHTML=a.map(j=>`<article class="job-card"><p class="kicker">${esc(j.shop_name||"居酒屋求人")}</p><h3>${esc(j.title||"スタッフ募集")}</h3><div class="salary">${esc(j.salary||"給与は店舗へお問い合わせください")}</div><p>${esc(j.description||"")}</p></article>`).join("");return}}}catch(e){}
 box.innerHTML='<div class="empty">求人情報は現在準備中です。店舗掲載とあわせて求人掲載も受付予定です。</div>';
}
home();listShops();detail();jobs();setupForms();
