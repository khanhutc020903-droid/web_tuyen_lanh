/* =========================================================================
   TUYẾN LẠNH — Cold-chain route advisor
   Single-file app. Storage: window.storage (personal, per-user).
   ========================================================================= */

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const MONTH_NAMES = ['','Tháng 1','Tháng 2','Tháng 3','Tháng 4','Tháng 5','Tháng 6','Tháng 7','Tháng 8','Tháng 9','Tháng 10','Tháng 11','Tháng 12'];

/* ---------------- utils ---------------- */
function uid(){ return 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2,8); }
function norm(s){ return (s||'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(); }
function escapeHtml(s){ return (s||'').toString().replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmt1(n){ return (n===null||n===undefined||isNaN(n)) ? '—' : n.toFixed(1); }
function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._h);
  toast._h = setTimeout(()=>t.classList.remove('show'), 2600);
}
function haversine(lat1,lon1,lat2,lon2){
  const R=6371, toRad=d=>d*Math.PI/180;
  const dLat=toRad(lat2-lat1), dLon=toRad(lon2-lon1);
  const a=Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function lerp(a,b,t){ return a+(b-a)*t; }
function parseDMY(str, swapped){
  // "15/05/2026" "19:11:33" -> Date. Handles an optional comma between date and time
  // ("02/07/2026, 11:00:57", used by some logger vendors instead of a plain space),
  // and both 2-digit and 4-digit years (some vendors write dd/mm/yy in header fields
  // even though the main data table uses a 4-digit year).
  // `swapped=false` (default) reads the numbers as DD/MM/YYYY; `swapped=true` reads
  // them as MM/DD/YYYY — different logger brands use different orderings.
  const m = str.match(/(\d{2})\/(\d{2})\/(\d{2,4}),?[ T]?(\d{2}):(\d{2}):(\d{2})/);
  if(!m) return null;
  const a = +m[1], b = +m[2];
  let year = +m[3];
  if(year < 100) year += 2000;
  const day = swapped ? b : a, month = swapped ? a : b;
  return new Date(year, month-1, day, +m[4], +m[5], +m[6]);
}

/* ==========================================================================
   FIREBASE CONFIG — dán config Firebase của bạn vào đây để bật kho dữ liệu
   DÙNG CHUNG cho mọi người truy cập trang web này.
   Xem hướng dẫn lấy config tại: https://console.firebase.google.com
   Nếu để nguyên placeholder (chưa dán config thật), app tự động dùng
   IndexedDB cục bộ trên từng máy (không dùng chung được) như trước.
   ========================================================================== */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyA5HXFZ7jMC9z79fyD-G-YS4ZGur7FTz0g",
  authDomain: "data-logger-8af48.firebaseapp.com",
  projectId: "data-logger-8af48",
  storageBucket: "data-logger-8af48.firebasestorage.app",
  messagingSenderId: "240099162931",
  appId: "1:240099162931:web:58e3baaf05722b51049c46"
};
/* Email của tài khoản admin duy nhất được phép XOÁ dữ liệu.
   Phải khớp đúng với email đặt trong Firestore Rules. */
const ADMIN_EMAIL = "expdocs2.cpc1hn@gmail.com";

/* App Check — chặn bot/script tự động dội request vào Firebase (đăng nhập, Firestore).
   Khác với đăng nhập (xác minh NGƯỜI), App Check xác minh yêu cầu đến từ ĐÚNG trang web
   này chứ không phải script bên ngoài.

   ⚠️ QUAN TRỌNG — có HAI loại site key reCAPTCHA và chúng KHÔNG dùng lẫn nhau được:
     • reCAPTCHA v3 "cổ điển"  (tạo ở google.com/recaptcha/admin, hoặc tạo thẳng trong
       Firebase > App Check)            → phải dùng ReCaptchaV3Provider
     • reCAPTCHA Enterprise            (tạo ở Google Cloud Console > Security > reCAPTCHA)
                                        → phải dùng ReCaptchaEnterpriseProvider
   Dùng sai loại ⇒ lỗi "appCheck/recaptcha-error" lặp vô tận trong console (đúng cái lỗi
   đang gặp). Code bên dưới TỰ DÒ xem key này thuộc loại nào rồi mới bật App Check,
   nên không cần đoán nữa. Nếu muốn ép cứng thì đổi APPCHECK_MODE bên dưới.

   Ngoài loại key, tên miền cũng phải được cho phép: trong danh sách "Domains" của key
   phải có đúng tên miền đang chạy (VD pharma-coldchain-manifest-swh8.vercel.app).
   Mỗi bản deploy preview của Vercel là một tên miền khác ⇒ chỉ nên dùng tên miền
   Production cố định, và thêm nó vào danh sách Domains. */
const RECAPTCHA_SITE_KEY = "6LcaYZstAAAAAPK0QSZ12xvRlqOBWP9lM7s4bh1p";

/* 'auto' = tự dò · 'enterprise' · 'v3' · 'off' = tắt hẳn App Check
   ┌──────────────────────────────────────────────────────────────────────────┐
   │ ĐANG ĐỂ 'off'. Site key 6LcaYZst... đã chết (Google trả về "Invalid site  │
   │ key" cho cả hai kiểu), nên App Check không thể chạy. Tắt hẳn để khỏi tốn  │
   │ 7 giây dò mỗi lần mở trang và khỏi rác console.                           │
   │                                                                          │
   │ MUỐN BẬT LẠI SAU NÀY — đúng 2 việc:                                       │
   │   1. Tạo site key reCAPTCHA mới, nhớ thêm tên miền production của Vercel  │
   │      vào danh sách Domains của key. Dán key mới vào RECAPTCHA_SITE_KEY     │
   │      ngay bên dưới.                                                       │
   │   2. Đổi dòng này thành:  const APPCHECK_MODE = 'auto';                   │
   │   3. Mở web, bấm 🛡️ Bảo mật. Xanh thì mới vào Firebase bật Enforce.       │
   └──────────────────────────────────────────────────────────────────────────┘ */
const APPCHECK_MODE = 'auto';

/* DẤU PHIÊN BẢN — để biết chắc web đang chạy file nào, khỏi phải đoán xem đã up
   đúng bản mới chưa. Hiện ở bảng "🛡️ Bảo mật" và in ra console lúc mở trang. */
const APP_VERSION = 'v16 · 2026-09-07 · lọc cả tên quốc gia theo loại hình';
console.log('%c[TUYẾN LẠNH] Phiên bản đang chạy: ' + APP_VERSION, 'color:#5bd9e8;font-weight:bold');

const HAS_FIREBASE = (typeof firebase !== 'undefined') && FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey !== 'YOUR_API_KEY';
let fsDb = null;
let fsAuth = null;
let isLoggedIn = false;
let isAdmin = false;
/* Trạng thái App Check để hiện trong bảng "Bảo mật" và log ra console. */
let appCheckState = { ok:false, provider:null, message:'Chưa khởi tạo' };

function _loadScriptOnce(src){
  return new Promise((resolve, reject)=>{
    const existing = document.querySelector('script[data-appcheck-src="'+src+'"]');
    if(existing){
      if(existing.dataset.loaded === '1') return resolve();
      /* Script đã hỏng lần trước: gỡ khỏi DOM rồi nạp lại. Bản cũ chỉ gắn thêm
         listener vào thẻ đã chết ⇒ listener không bao giờ chạy, lời hứa treo mãi. */
      if(existing.dataset.failed === '1'){ existing.remove(); }
      else{
        existing.addEventListener('load', ()=>resolve());
        existing.addEventListener('error', ()=>reject(new Error('Không tải được '+src)));
        return;
      }
    }
    const s = document.createElement('script');
    s.src = src; s.async = true; s.defer = true;
    s.dataset.appcheckSrc = src;
    s.onload = ()=>{ s.dataset.loaded = '1'; resolve(); };
    s.onerror = ()=>{ s.dataset.failed = '1'; reject(new Error('Không tải được '+src+' (mạng chặn hoặc adblock?)')); };
    document.head.appendChild(s);
  });
}
function _withTimeout(p, ms, label){
  return Promise.race([
    Promise.resolve(p),
    new Promise((_,rej)=>setTimeout(()=>rej(new Error('Hết giờ chờ: '+label)), ms))
  ]);
}
/* ⚠️ enterprise.js và api.js KHÔNG sống chung được trong cùng một window: script nào
   nạp trước sẽ đặt window.___grecaptcha_cfg, script sau thấy có rồi nên bỏ qua phần
   khởi tạo ⇒ grecaptcha.execute không bao giờ xuất hiện và phép thử thứ hai luôn báo
   sai. Vì vậy mỗi phép thử được chạy trong MỘT IFRAME RIÊNG (window sạch, nhưng vẫn
   kế thừa nguyên origin của trang nên reCAPTCHA thấy đúng tên miền), và window chính
   được giữ sạch hoàn toàn để Firebase tự nạp script của nó sau đó. */
function _makeProbeFrame(){
  const ifr = document.createElement('iframe');
  ifr.setAttribute('aria-hidden', 'true');
  ifr.setAttribute('tabindex', '-1');
  ifr.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px;border:0;visibility:hidden;';
  document.body.appendChild(ifr);
  return ifr;
}
function _loadScriptIn(win, src){
  return new Promise((resolve, reject)=>{
    const d = win.document;
    const s = d.createElement('script');
    s.src = src; s.async = true;
    s.onload  = ()=>resolve();
    s.onerror = ()=>reject(new Error('không tải được script (mạng chặn hoặc adblock?)'));
    (d.head || d.documentElement).appendChild(s);
  });
}
/* api.js / enterprise.js chỉ là script mồi: nạp xong nó mới đi tải tiếp gói
   recaptcha__<lang>.js, và grecaptcha.execute chỉ xuất hiện SAU khi gói đó chạy.
   Kiểm tra ngay tại onload là quá sớm ⇒ luôn báo "không tạo grecaptcha.execute"
   kể cả khi key hoàn toàn hợp lệ. Vì vậy phải chờ có thật rồi mới kết luận. */
function _waitFor(fn, ms, label){
  const deadline = Date.now() + ms;
  return new Promise((resolve, reject)=>{
    (function tick(){
      let v = null;
      try{ v = fn(); }catch(e){}
      if(v) return resolve(v);
      if(Date.now() > deadline) return reject(new Error('chờ mãi không thấy ' + label));
      setTimeout(tick, 120);
    })();
  });
}
/* kind: 'enterprise' | 'v3'. Ném lỗi nếu key không thuộc loại đó, hoặc tên miền
   hiện tại chưa nằm trong danh sách Domains của key. */
async function _probeKind(kind, key){
  const ifr = _makeProbeFrame();
  try{
    const win = ifr.contentWindow;
    if(kind === 'enterprise'){
      await _withTimeout(_loadScriptIn(win, 'https://www.google.com/recaptcha/enterprise.js?render='+encodeURIComponent(key)), 8000, 'tải enterprise.js');
      const ent = await _waitFor(()=> (win.grecaptcha && win.grecaptcha.enterprise && typeof win.grecaptcha.enterprise.execute === 'function') ? win.grecaptcha.enterprise : null,
                                 7000, 'grecaptcha.enterprise');
      await _withTimeout(new Promise(res=>ent.ready(res)), 6000, 'enterprise.ready');
      const t = await _withTimeout(ent.execute(key, {action:'appcheck_probe'}), 8000, 'enterprise.execute');
      if(!t) throw new Error('trả về token rỗng');
    }else{
      await _withTimeout(_loadScriptIn(win, 'https://www.google.com/recaptcha/api.js?render='+encodeURIComponent(key)), 8000, 'tải api.js');
      const g = await _waitFor(()=> (win.grecaptcha && typeof win.grecaptcha.execute === 'function') ? win.grecaptcha : null,
                               7000, 'grecaptcha.execute');
      await _withTimeout(new Promise(res=>g.ready(res)), 6000, 'v3.ready');
      const t = await _withTimeout(g.execute(key, {action:'appcheck_probe'}), 8000, 'v3.execute');
      if(!t) throw new Error('trả về token rỗng');
    }
    return true;
  }finally{
    setTimeout(()=>{ try{ ifr.remove(); }catch(e){} }, 0);
  }
}
async function _detectRecaptchaKind(key){
  if(APPCHECK_MODE === 'enterprise' || APPCHECK_MODE === 'v3') return APPCHECK_MODE;
  /* Hai phép thử nằm ở hai iframe tách biệt nên chạy SONG SONG được. Chạy nối
     tiếp thì trường hợp key chết phải chờ hết hạn hai lần (~1 phút) mới cho đăng
     nhập được — chạy song song thì chỉ mất thời gian của một phép thử. */
  const errs = {};
  const [rv3, rent] = await Promise.allSettled([
    _probeKind('v3', key),
    _probeKind('enterprise', key)
  ]);
  if(rv3.status === 'fulfilled') return 'v3';
  if(rent.status === 'fulfilled') return 'enterprise';
  errs.v3 = rv3.reason ? rv3.reason.message : 'lỗi không rõ';
  errs.enterprise = rent.reason ? rent.reason.message : 'lỗi không rõ';

  /* Diễn giải lỗi thành việc cần làm, thay vì ném nguyên văn tiếng Anh của Google. */
  const all = ((errs.v3||'') + ' ' + (errs.enterprise||'')).toLowerCase();
  let why;
  if(all.indexOf('chờ mãi không thấy') >= 0 && all.indexOf('invalid') < 0){
    why = 'Script reCAPTCHA nạp được nhưng không khởi tạo nổi với site key này — gần như chắc chắn key đã bị xoá hoặc không tồn tại. Tạo site key mới rồi thay vào code.';
  }else if(all.indexOf('invalid domain') >= 0){
    why = 'Google báo SAI TÊN MIỀN. Mở trang quản lý site key, thêm "' + location.hostname + '" vào danh sách Domains.';
  }else if(all.indexOf('invalid site key') >= 0 || all.indexOf('invalid key') >= 0){
    why = 'Google báo KHÔNG TÌM THẤY key này. Hoặc key đã bị xoá, hoặc site key trong code không khớp với key thật, hoặc tên miền "' + location.hostname + '" chưa có trong danh sách Domains của key.';
  }else if(all.indexOf('không tải được') >= 0){
    why = 'Không tải nổi script reCAPTCHA — mạng công ty chặn google.com, hoặc trình duyệt đang bật chặn quảng cáo.';
  }else{
    why = 'Không lấy được token reCAPTCHA. Kiểm tra key còn tồn tại và tên miền "' + location.hostname + '" đã có trong danh sách Domains.';
  }
  const err = new Error(why);
  err.detail = 'v3: ' + (errs.v3 || 'ok') + ' | Enterprise: ' + (errs.enterprise || 'ok');
  throw err;
}
async function setupAppCheck(){
  if(APPCHECK_MODE === 'off'){
    appCheckState = { ok:false, provider:null, message:'Đã tắt thủ công (APPCHECK_MODE = "off")' };
    return;
  }
  if(!RECAPTCHA_SITE_KEY || RECAPTCHA_SITE_KEY === 'YOUR_RECAPTCHA_V3_SITE_KEY'){
    appCheckState = { ok:false, provider:null, message:'Chưa dán site key reCAPTCHA' };
    return;
  }
  /* Chạy trên máy cá nhân (localhost / mở file trực tiếp) thì reCAPTCHA không hoạt động
     được — bật debug token để vẫn test được. Lần đầu chạy, console sẽ in ra 1 mã UUID,
     copy mã đó dán vào Firebase > App Check > app > ⋮ > Manage debug tokens. */
  const host = location.hostname;
  if(host === 'localhost' || host === '127.0.0.1' || location.protocol === 'file:'){
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  let kind;
  try{
    kind = await _detectRecaptchaKind(RECAPTCHA_SITE_KEY);
  }catch(e){
    appCheckState = { ok:false, provider:null, message:e.message, detail:e.detail || '' };
    console.error('[App Check] ' + e.message);
    if(e.detail) console.error('[App Check] chi tiết kỹ thuật — ' + e.detail);
    console.error('[App Check] ⚠️ ĐỪNG bật Enforce trong Firebase console khi còn dòng lỗi này, nếu bật app sẽ ngừng đăng nhập/lưu được.');
    return;
  }
  try{
    const provider = (kind === 'enterprise')
      ? new firebase.appCheck.ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY)
      : new firebase.appCheck.ReCaptchaV3Provider(RECAPTCHA_SITE_KEY);
    firebase.appCheck().activate(provider, true);
    await _withTimeout(firebase.appCheck().getToken(), 15000, 'appCheck.getToken');
    appCheckState = { ok:true, provider:kind,
      message:'Đang chạy tốt với provider "'+(kind === 'enterprise' ? 'reCAPTCHA Enterprise' : 'reCAPTCHA v3')+'". Có thể bật Enforce trong Firebase console.' };
    console.log('%c[App Check] ✅ ' + appCheckState.message, 'color:#22c55e');
  }catch(e){
    /* Lấy được token reCAPTCHA nhưng Firebase từ chối đổi sang App Check token ⇒
       key chưa được đăng ký (hoặc đăng ký nhầm ô) trong Firebase > App Check > Apps. */
    appCheckState = { ok:false, provider:kind,
      message:'reCAPTCHA chạy được (loại '+kind+') nhưng Firebase từ chối đổi token. Vào Firebase > App Check > Apps > "Data logger", dán ĐÚNG site key này vào ô "'+(kind === 'enterprise' ? 'reCAPTCHA Enterprise' : 'reCAPTCHA')+'". Lỗi: '+(e.code || e.message) };
    console.error('[App Check] ' + appCheckState.message);
  }
  if(typeof updateSecurityPanel === 'function') updateSecurityPanel();
  if(typeof updateAccountPanel === 'function') updateAccountPanel();
}

if(HAS_FIREBASE){
  try{
    firebase.initializeApp(FIREBASE_CONFIG);
    /* App Check phải được bật TRƯỚC khi Firestore/Auth gửi request đầu tiên, nên
       toàn bộ phần khởi tạo nằm trong hàm async này. Nếu App Check hỏng thì vẫn
       chạy tiếp (app không chết) — chỉ là chưa có lớp chặn bot. */
    (async ()=>{
      const gateErr = document.getElementById('gate-error');
      if(gateErr){
        gateErr.textContent = 'Đang kiểm tra lớp bảo mật, chờ vài giây…';
        gateErr.style.color = 'var(--text-dim)';
        gateErr.style.display = 'block';
      }
      /* Chặn trên cứng: dù phép dò có kẹt thế nào cũng không được giữ màn hình
         đăng nhập quá 25 giây. Hỏng thì bỏ App Check, app vẫn chạy. */
      try{ await _withTimeout(setupAppCheck(), 25000, 'setupAppCheck'); }
      catch(e){
        console.error('[App Check] bỏ qua vì quá lâu hoặc lỗi:', e.message);
        if(!appCheckState.message || appCheckState.message === 'Chưa khởi tạo'){
          appCheckState = { ok:false, provider:null, message:'Kiểm tra quá lâu nên đã bỏ qua App Check. App vẫn chạy bình thường (đừng bật Enforce).', detail:e.message };
        }
      }
      if(gateErr){
        gateErr.style.display = 'none';
        gateErr.style.color = 'var(--danger)';
      }
      fsDb = firebase.firestore();
      fsDb = firebase.firestore();
      fsAuth = firebase.auth();
      fsAuth.onAuthStateChanged(async user => {
        isLoggedIn = !!user;
        if(!isLoggedIn){
          if(typeof mfaAbortFlow === 'function') mfaAbortFlow();
        }
        isAdmin = !!user && user.email === ADMIN_EMAIL;
        updateAdminUI();
        updateGate();
        if(isLoggedIn) renderLibrary();
        if(typeof updateSecurityPanel === 'function') updateSecurityPanel();
        if(typeof updateAccountPanel === 'function') updateAccountPanel();
      });
    })();
  }catch(e){ console.error('Firebase init failed', e); }
}
const FS_COLLECTION = 'coldroute_shared';
async function fsGet(key){
  const doc = await fsDb.collection(FS_COLLECTION).doc(key).get();
  return doc.exists ? doc.data().value : null;
}
async function fsSet(key, value){
  await fsDb.collection(FS_COLLECTION).doc(key).set({ value, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
  return true;
}
async function fsDelete(key){
  await fsDb.collection(FS_COLLECTION).doc(key).delete();
  return true;
}

/* ---------------- storage helpers ---------------- */
/* Priority: Firebase Firestore (real shared storage for everyone on this page)
   > window.storage (when previewed inside Claude.ai)
   > IndexedDB (local-only fallback, per browser/device). */
const HAS_CLAUDE_STORAGE = (typeof window !== 'undefined' && window.storage && typeof window.storage.get === 'function');

const IDB_NAME = 'coldroute-db', IDB_VERSION = 1, IDB_STORE = 'kv';
let _idbPromise = null;
function openIDB(){
  if(_idbPromise) return _idbPromise;
  _idbPromise = new Promise((resolve, reject)=>{
    if(!('indexedDB' in window)){ reject(new Error('IndexedDB không khả dụng trên trình duyệt này')); return; }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = ()=>{ req.result.createObjectStore(IDB_STORE); };
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error);
  });
  return _idbPromise;
}
async function idbGet(key){
  const db = await openIDB();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(IDB_STORE,'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = ()=>resolve(req.result===undefined ? null : req.result);
    req.onerror = ()=>reject(req.error);
  });
}
async function idbSet(key, value){
  const db = await openIDB();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(IDB_STORE,'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = ()=>resolve(true);
    tx.onerror = ()=>reject(tx.error);
  });
}
async function idbDelete(key){
  const db = await openIDB();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(IDB_STORE,'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = ()=>resolve(true);
    tx.onerror = ()=>reject(tx.error);
  });
}

let _storageBroken = false;
async function safeGet(key, shared=false){
  try{
    if(HAS_FIREBASE){
      return await fsGet(key);
    }else if(HAS_CLAUDE_STORAGE){
      const r = await window.storage.get(key, shared);
      return r ? r.value : null;
    }else{
      const v = await idbGet(key);
      return (v===null||v===undefined) ? null : v;
    }
  }catch(e){ console.error('storage get failed', key, e); return null; }
}
async function safeSet(key, value, shared=false){
  try{
    if(HAS_FIREBASE) return await fsSet(key, value);
    if(HAS_CLAUDE_STORAGE) return await window.storage.set(key, value, shared);
    await idbSet(key, value);
    return true;
  }catch(e){
    console.error('storage set failed', key, e);
    if(!_storageBroken){
      _storageBroken = true;
      toast(HAS_FIREBASE
        ? 'Không lưu được dữ liệu lên Firebase (kiểm tra lại config/quyền Firestore Rules).'
        : 'Không lưu được dữ liệu vào trình duyệt (có thể do chế độ ẩn danh / trình duyệt chặn lưu trữ). Thử mở bằng tab thường.');
    }
    return null;
  }
}
async function safeDelete(key, shared=false){
  try{
    if(HAS_FIREBASE) return await fsDelete(key);
    if(HAS_CLAUDE_STORAGE) return await window.storage.delete(key, shared);
    await idbDelete(key);
    return true;
  }catch(e){ console.error('storage delete failed', key, e); return null; }
}

/* Metadata listing: on Firebase, each shipment gets its OWN document inside a
   dedicated collection (no shared array, no size ceiling, scales to any count).
   Without Firebase (local/personal fallback), keep the old single-array-key
   approach since that use case won't realistically reach thousands of entries. */
const META_COLLECTION = 'shipments_meta';

let memoryIndexCache = null;
let memoryIndexTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

async function loadIndex(){
  if(memoryIndexCache && Date.now() - memoryIndexTime < CACHE_TTL){
    return memoryIndexCache;
  }
  let result = [];
  if(HAS_FIREBASE){
    try{
      const snap = await fsDb.collection(META_COLLECTION).get();
      result = snap.docs.map(d=>d.data());
    }catch(e){ console.error('loadIndex (firestore) failed', e); }
  } else {
    const raw = await safeGet('shipment-index', false);
    if(raw) try{ result = JSON.parse(raw); }catch(e){}
  }
  memoryIndexCache = result;
  memoryIndexTime = Date.now();
  return result;
}

async function saveIndexEntry(meta){
  if(HAS_FIREBASE){
    try{ 
      await fsDb.collection(META_COLLECTION).doc(meta.id).set(meta); 
      memoryIndexCache = null;
      return true; 
    }
    catch(e){ console.error('saveIndexEntry (firestore) failed', e); return null; }
  }
  const idx = await loadIndex();
  idx.push(meta);
  memoryIndexCache = idx;
  memoryIndexTime = Date.now();
  await safeSet('shipment-index', JSON.stringify(idx), false);
  return true;
}

async function deleteIndexEntry(id){
  if(HAS_FIREBASE){
    try{ 
      await fsDb.collection(META_COLLECTION).doc(id).delete(); 
      memoryIndexCache = null;
      return true; 
    }
    catch(e){ console.error('deleteIndexEntry (firestore) failed', e); return null; }
  }
  const idx = (await loadIndex()).filter(x=>x.id!==id);
  memoryIndexCache = idx;
  memoryIndexTime = Date.now();
  await safeSet('shipment-index', JSON.stringify(idx), false);
  return true;
}
async function saveShipment(record){
  await safeSet('shipment:'+record.id, JSON.stringify(record), false);
  await saveIndexEntry({
    id: record.id, fileName: record.fileName,
    origin: record.origin, dest: record.dest, destPort: record.destPort,
    originLat: record.originLat, originLon: record.originLon,
    destLat: record.destLat, destLon: record.destLon,
    drug: record.drug, reqMin: record.reqMin, reqMax: record.reqMax,
    deviceId: record.deviceId, transportMode: record.transportMode,
    start: record.start, stop: record.stop,
    min: record.min, max: record.max, avg: record.avg,
    months: record.months, uploadedAt: record.uploadedAt
  });
}
async function getShipment(id){
  const raw = await safeGet('shipment:'+id, false);
  return raw ? JSON.parse(raw) : null;
}
/* Trả về true nếu xoá THẬT SỰ thành công. Trước đây hàm này nuốt lỗi rồi vẫn để
   giao diện báo "Đã xoá." — khi Firestore Rules hoặc App Check từ chối, người dùng
   tưởng đã xoá xong trong khi dữ liệu còn nguyên. */
async function deleteShipment(id){
  const a = await deleteIndexEntry(id);
  const b = await safeDelete('shipment:'+id, false);
  return a !== null && b !== null;
}

/* ---------------- geocode + climate (Open-Meteo, free, CORS-enabled) ---------------- */
/* Known major ports/cities relevant to VN pharma shipping — checked before the free
   geocoding API, which sometimes fails to match local/regional port names exactly. */

function lookupKnownPort(name){
  const n = ' ' + norm(name).replace(/[''`]/g,'').replace(/[,.]/g,' ').replace(/\s+/g,' ').trim() + ' ';
  let best = null;
  for(const p of KNOWN_PORTS){
    for(const k of p.keys){
      if(n.includes(' '+k+' ') || n.trim()===k){
        if(!best || k.length > best._k.length){ best = {lat:p.lat, lon:p.lon, label:p.label, _k:k}; }
      }
    }
  }
  return best ? {lat:best.lat, lon:best.lon, label:best.label} : null;
}

async function geocodeRaw(name){
  const url = 'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(name.trim()) + '&count=1&format=json';
  const res = await fetch(url);
  const data = await res.json();
  if(data && data.results && data.results.length){
    const r = data.results[0];
    return { lat:r.latitude, lon:r.longitude, label:[r.name,r.admin1,r.country].filter(Boolean).join(', ') };
  }
  return null;
}
async function geocode(name){
  if(!name || !name.trim()) return null;
  const known = lookupKnownPort(name);
  if(known) return known;

  const cacheKey = 'geocode:' + norm(name);
  const cached = await safeGet(cacheKey, false);
  if(cached){ try{ return JSON.parse(cached); }catch(e){} }

  try{
    // Open-Meteo requires the part after a comma (country/admin) to match EXACTLY.
    // "Hải Phòng, Việt Nam" fails because "Việt Nam" isn't the indexed English form,
    // even though "Hải Phòng" alone matches fine (name matching is diacritic-insensitive).
    let out = await geocodeRaw(name);
    if(!out && name.includes(',')){
      const firstPart = name.split(',')[0].trim();
      if(firstPart) out = await geocodeRaw(firstPart);
    }
    if(!out){
      const stripped = norm(name).split(',')[0].trim();
      if(stripped && stripped !== norm(name)) out = await geocodeRaw(stripped);
    }
    if(out) await safeSet(cacheKey, JSON.stringify(out), false);
    return out;
  }catch(e){ console.error('geocode failed', e); return null; }
}

function pickYearForMonth(month){
  const now = new Date();
  const curM = now.getMonth()+1, curY = now.getFullYear();
  return (month < curM) ? curY : curY - 1;
}

async function fetchWithTimeout(url, ms){
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), ms);
  try{
    const res = await fetch(url, {signal: controller.signal});
    return res;
  }finally{ clearTimeout(timer); }
}

async function fetchMonthClimate(lat, lon, year, month){
  const cacheKey = `climate:${lat.toFixed(2)}:${lon.toFixed(2)}:${year}:${month}`;
  const cached = await safeGet(cacheKey, false);
  if(cached){ try{ return JSON.parse(cached); }catch(e){} }
  const mm = String(month).padStart(2,'0');
  const lastDay = new Date(year, month, 0).getDate();
  const start = `${year}-${mm}-01`, end = `${year}-${mm}-${String(lastDay).padStart(2,'0')}`;
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${start}&end_date=${end}&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean&timezone=auto`;

  // Open-Meteo's historical archive occasionally times out transiently — retry a
  // couple of times with a short backoff before giving up, instead of failing on
  // the first hiccup.
  const ATTEMPTS = 3;
  for(let attempt=1; attempt<=ATTEMPTS; attempt++){
    try{
      const res = await fetchWithTimeout(url, 12000);
      const data = await res.json();
      if(!data || !data.daily) throw new Error('no daily data in response');
      const tmax = data.daily.temperature_2m_max || [];
      const tmin = data.daily.temperature_2m_min || [];
      const tmean = data.daily.temperature_2m_mean || [];
      const out = {
        year, month, days: tmax.length,
        dates: data.daily.time || [],
        tmax, tmin, tmean,
        avgMax: tmax.reduce((a,b)=>a+b,0)/tmax.length,
        avgMin: tmin.reduce((a,b)=>a+b,0)/tmin.length,
        avgMean: tmean.reduce((a,b)=>a+b,0)/tmean.length,
        hiMax: Math.max(...tmax),
        loMin: Math.min(...tmin),
        over30: tmax.filter(t=>t>30).length,
        over35: tmax.filter(t=>t>35).length,
        over40: tmax.filter(t=>t>40).length,
      };
      await safeSet(cacheKey, JSON.stringify(out), false);
      return out;
    }catch(e){
      console.error(`climate fetch failed (attempt ${attempt}/${ATTEMPTS})`, e);
      if(attempt < ATTEMPTS) await new Promise(r=>setTimeout(r, 800*attempt));
      else { climateFetchHadNetworkError = true; return null; }
    }
  }
}
let climateFetchHadNetworkError = false;

/* ---------------- PDF parsing ---------------- */
async function parsePdf(file){
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({data: buf}).promise;
      const textChunks = [];
    for(let p=1; p<=pdf.numPages; p++){
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      textChunks.push(content.items.map(it=>it.str).join(' '));
    }
    let fullText = textChunks.join('\n');

  // The "Alarm Statistics" section lists histogram bucket-edge timestamps immediately
  // followed by bucket-edge temperatures (e.g. "...20:11:33 -1.0 C 1.6 C 4.2 C...").
  // This can look exactly like a real "date time value" reading and pollute the parse.
  // The real logged readings only start at the repeating "Date Time ... °C" table header
  // on the following pages, so we cut everything before that away first.
  const tableHeaderIdx = fullText.indexOf('Date Time');
  const dataText = tableHeaderIdx >= 0 ? fullText.slice(tableHeaderIdx) : fullText;

  // Different logger vendors write dates as DD/MM/YYYY or MM/DD/YYYY — genuinely
  // ambiguous when both day and month are ≤12, which is common within a single short
  // trip. Disambiguate using the "Trip Length" the report itself states (e.g.
  // "05d 03h 00m 00s"): try both orderings on the window bounds and see which one's
  // (stop − start) duration actually matches that stated length.
  const winMatchRaw = fullText.match(/(\d{2}\/\d{2}\/\d{2,4},?\s*\d{2}:\d{2}:\d{2})[^\d\n]{0,40}(\d{2}\/\d{2}\/\d{2,4},?\s*\d{2}:\d{2}:\d{2})/);
  const tripLenMatch = fullText.match(/(\d+)\s*d\s*(\d+)\s*h\s*(\d+)\s*m\s*(\d+)\s*s/i);
  let swapped = false;
  if(winMatchRaw && tripLenMatch){
    const statedMs = ((+tripLenMatch[1]*24 + +tripLenMatch[2])*60 + +tripLenMatch[3])*60000 + (+tripLenMatch[4])*1000;
    const sNormal = parseDMY(winMatchRaw[1], false), eNormal = parseDMY(winMatchRaw[2], false);
    const sSwap = parseDMY(winMatchRaw[1], true), eSwap = parseDMY(winMatchRaw[2], true);
    const durNormal = (sNormal && eNormal) ? Math.abs((eNormal-sNormal) - statedMs) : Infinity;
    const durSwap = (sSwap && eSwap) ? Math.abs((eSwap-sSwap) - statedMs) : Infinity;
    swapped = durSwap < durNormal;
  }else if(winMatchRaw){
    // No stated trip length to check against — fall back to inspecting every date
    // token: if the SECOND number ever exceeds 12, the ordering must be DD/MM
    // (so NOT swapped); if the FIRST number ever exceeds 12, it must be MM/DD
    // (swapped). Ambiguous cases default to the original DD/MM assumption.
          const tokens = dataText.matchAll(/(\d{2})\/(\d{2})\/\d{4}/g);
      for(const t of tokens){
      const a = +t[1], b = +t[2];
      if(b > 12){ swapped = false; break; }
      if(a > 12){ swapped = true; break; }
    }
  }

  // Authoritative logging window, read directly from the "Logging Summary" block.
  // Any parsed reading outside this window (e.g. stray histogram bucket-edge
  // timestamps elsewhere in the document) is discarded below, regardless of where
  // in the text it was found.
  let officialStart = null, officialStop = null;
  if(winMatchRaw){
    const s = parseDMY(winMatchRaw[1], swapped), e = parseDMY(winMatchRaw[2], swapped);
    if(s && e && e.getTime() > s.getTime()){ officialStart = s.getTime(); officialStop = e.getTime(); }
  }

  // 1) extract all timestamp+value pairs anywhere in the (trimmed) text, sort & dedupe by time
  const re = /(\d{2}\/\d{2}\/\d{4}),?\s+(\d{2}:\d{2}:\d{2})\s+(-?\d{1,3}\.\d)\b/g;
  const found = new Map();
  let m;
  while((m = re.exec(dataText)) !== null){
    const dateStr = m[1], timeStr = m[2], val = parseFloat(m[3]);
    if(val < -60 || val > 90) continue; // sanity bounds
    const dt = parseDMY(dateStr + ' ' + timeStr, swapped);
    if(!dt) continue;
    const key = dt.getTime();
    if(!found.has(key)) found.set(key, val);
  }
  let points = Array.from(found.entries()).map(([t,c])=>({t, c})).sort((a,b)=>a.t-b.t);

  if(officialStart !== null && officialStop !== null){
    points = points.filter(p => p.t >= officialStart && p.t <= officialStop);
  }

  // sanity: if too few points parsed, bail with error
  if(points.length < 5){
    throw new Error('Không đọc được dữ liệu nhiệt độ dạng bảng trong file này. Hãy kiểm tra lại file PDF (cần đúng định dạng data logger dạng Date/Time/°C).');
  }

  // 2) device id best-effort
  let deviceId = 'N/A';
  const devMatch = fullText.match(/\b([A-Z]{1,3}\d{5,12})\b/);
  if(devMatch) deviceId = devMatch[1];

  const values = points.map(p=>p.c);
  const min = Math.min(...values), max = Math.max(...values);
  const avg = values.reduce((a,b)=>a+b,0)/values.length;
  const start = officialStart !== null ? officialStart : points[0].t;
  const stop = officialStop !== null ? officialStop : points[points.length-1].t;

  // months spanned (calendar month numbers present in trip, 1-12, deduped)
  const monthsSet = new Set();
  points.forEach(p => monthsSet.add(new Date(p.t).getMonth()+1));

  return {
    fileName: file.name,
    deviceId,
    points, // [{t: epoch ms, c: number}]
    min, max, avg,
    start, stop,
    months: Array.from(monthsSet).sort((a,b)=>a-b),
    pointCount: points.length,
  };
}

/* ---------------- thermal ribbon canvas ---------------- */
function drawLoggerLineChart(canvas, points){
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 600, h = canvas.clientHeight || 220;
  canvas.width = w*dpr; canvas.height = h*dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr,dpr);
  ctx.clearRect(0,0,w,h);
  if(!points.length) return;

  const vals = points.map(p=>p.c);
  let vmin = Math.min(...vals), vmax = Math.max(...vals);
  const pad = (vmax-vmin)*0.15 || 2;
  vmin -= pad; vmax += pad;

  const n = points.length;
  const leftPad=38, rightPad=8, topPad=12, botPad=26;
  const plotW = w-leftPad-rightPad, plotH = h-topPad-botPad;
  const xAt = i => leftPad + (n<=1?0:(i/(n-1))*plotW);
  const yAt = v => topPad + plotH - ((v-vmin)/(vmax-vmin))*plotH;

  const step = niceStep(vmax-vmin, 4);
  const gridStart = Math.ceil(vmin/step)*step;
  ctx.font = '10px "IBM Plex Mono", monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for(let g=gridStart; g<=vmax; g+=step){
    const py = yAt(g);
    ctx.strokeStyle = 'rgba(231,236,243,.08)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(leftPad, py); ctx.lineTo(leftPad+plotW, py); ctx.stroke();
    ctx.fillStyle = 'rgba(140,160,188,.8)';
    ctx.fillText(Math.round(g)+'°', leftPad-6, py);
  }
  ctx.textBaseline = 'alphabetic';

  ctx.beginPath();
  points.forEach((p,i)=>{
    const px=xAt(i), py=yAt(p.c);
    if(i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
  });
  ctx.strokeStyle = '#5BD9E8';
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.stroke();

  ctx.font = '10px Inter, sans-serif';
  ctx.fillStyle = 'rgba(231,236,243,.6)';
  ctx.textAlign = 'left';
  ctx.fillText(new Date(points[0].t).toLocaleDateString('vi-VN'), leftPad, topPad+plotH+16);
  ctx.textAlign = 'right';
  ctx.fillText(new Date(points[n-1].t).toLocaleDateString('vi-VN'), leftPad+plotW, topPad+plotH+16);
}

function drawRibbon(canvas, points, globalMin=null, globalMax=null){
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 600, h = canvas.clientHeight || 46;
  canvas.width = w*dpr; canvas.height = h*dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr,dpr);
  const values = points.map(p=>p.c);
  const min = globalMin!==null ? globalMin : Math.min(...values);
  const max = globalMax!==null ? globalMax : Math.max(...values);
  const range = Math.max(1, max-min);

  function colorFor(t){
    // 0 -> blue (cold), .35 -> cyan, .65 -> amber, 1 -> red (hot)
    const stops = [
      [0.00, [46,111,224]],
      [0.30, [91,217,232]],
      [0.60, [242,166,90]],
      [1.00, [255,110,110]],
    ];
    for(let i=0;i<stops.length-1;i++){
      const [t0,c0]=stops[i], [t1,c1]=stops[i+1];
      if(t>=t0 && t<=t1){
        const f=(t-t0)/(t1-t0);
        return `rgb(${Math.round(lerp(c0[0],c1[0],f))},${Math.round(lerp(c0[1],c1[1],f))},${Math.round(lerp(c0[2],c1[2],f))})`;
      }
    }
    return 'rgb(255,110,110)';
  }

  const n = points.length;
  for(let i=0;i<n-1;i++){
    const x0 = (i/(n-1))*w, x1 = ((i+1)/(n-1))*w;
    const tval = (points[i].c - min)/range;
    ctx.fillStyle = colorFor(Math.max(0,Math.min(1,tval)));
    ctx.fillRect(x0, 0, (x1-x0)+1, h);
  }
}

/* ---------------- recommendation logic ---------------- */
function computeDayStats(points){
  // group hourly readings into per-calendar-day max, then count days over each
  // threshold plus the longest run of CONSECUTIVE calendar days over that threshold.
  const dayMax = new Map();
  points.forEach(p=>{
    const d = new Date(p.t);
    const key = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    const cur = dayMax.get(key);
    if(cur===undefined || p.c>cur) dayMax.set(key, p.c);
  });
  const days = Array.from(dayMax.entries()).sort((a,b)=> a[0]<b[0] ? -1 : (a[0]>b[0]?1:0));
  function countAndStreak(threshold){
    let count=0, streak=0, maxStreak=0;
    days.forEach(([,v])=>{
      if(v>threshold){ count++; streak++; if(streak>maxStreak) maxStreak=streak; }
      else streak=0;
    });
    return {count, maxStreak};
  }
  const c30=countAndStreak(30), c35=countAndStreak(35), c40=countAndStreak(40);
  return {
    totalDays: days.length,
    over30: c30.count, streak30: c30.maxStreak,
    over35: c35.count, streak35: c35.maxStreak,
    over40: c40.count, streak40: c40.maxStreak,
  };
}

function recommend(reqMin, reqMax, obsMin, obsMax){
  const margin = 1.0;
  const hasReq = (reqMin!==null && !isNaN(reqMin)) || (reqMax!==null && !isNaN(reqMax));
  if(!hasReq) return {level:'unknown'};
  let breachHigh = (reqMax!==null && !isNaN(reqMax)) ? obsMax > reqMax : false;
  let breachLow  = (reqMin!==null && !isNaN(reqMin)) ? obsMin < reqMin : false;
  let nearHigh = (reqMax!==null && !isNaN(reqMax)) ? (obsMax > reqMax - margin && !breachHigh) : false;
  let nearLow  = (reqMin!==null && !isNaN(reqMin)) ? (obsMin < reqMin + margin && !breachLow) : false;

  if(breachHigh || breachLow){
    return {level:'reefer', breachHigh, breachLow};
  }
  if(nearHigh || nearLow){
    return {level:'borderline', nearHigh, nearLow};
  }
  return {level:'standard'};
}

function verdictBlock(rec, obsMin, obsMax, reqMin, reqMax, sourceLabel){
  const reqTxt = `${reqMin!==null&&!isNaN(reqMin)?reqMin+'°C':'—'} ~ ${reqMax!==null&&!isNaN(reqMax)?reqMax+'°C':'—'}`;
  /* Chưa nhập ngưỡng bảo quản thì không hiện gì cả — biểu đồ và số liệu bên dưới
     đã nói đủ, thêm một khối cảnh báo to nữa chỉ tổ rối mắt. */
  if(rec.level==='unknown') return '';
  if(rec.level==='reefer'){
    const parts=[];
    if(rec.breachHigh) parts.push(`nhiệt độ cao nhất ghi nhận ${fmt1(obsMax)}°C vượt ngưỡng tối đa cho phép`);
    if(rec.breachLow) parts.push(`nhiệt độ thấp nhất ${fmt1(obsMin)}°C thấp hơn ngưỡng tối thiểu cho phép`);
    return `<div class="verdict reefer">
      <div class="verdict-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9L4.9 19.1"/></svg></div>
      <div><h2>Nên dùng container LẠNH</h2><p>Theo ${sourceLabel}, ${parts.join(' và ')} (ngưỡng yêu cầu ${reqTxt}). Vận chuyển thường có nguy cơ vi phạm điều kiện bảo quản.</p></div>
    </div>`;
  }
  if(rec.level==='borderline'){
    return `<div class="verdict borderline">
      <div class="verdict-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg></div>
      <div><h2>Cận ngưỡng — cân nhắc container lạnh</h2><p>Theo ${sourceLabel}, nhiệt độ tuyến (${fmt1(obsMin)}°C – ${fmt1(obsMax)}°C) nằm sát ngưỡng yêu cầu (${reqTxt}), biên an toàn dưới 1°C. Nên ưu tiên container lạnh hoặc giám sát chặt bằng data logger.</p></div>
    </div>`;
  }
  return `<div class="verdict standard">
      <div class="verdict-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg></div>
      <div><h2>Container THƯỜNG là đủ</h2><p>Theo ${sourceLabel}, nhiệt độ tuyến dự kiến (${fmt1(obsMin)}°C – ${fmt1(obsMax)}°C) nằm trong ngưỡng yêu cầu (${reqTxt}), có biên an toàn ≥1°C.</p></div>
    </div>`;
}

/* ================= TAB SWITCHING ================= */
document.getElementById('tabs').addEventListener('click', e=>{
  const btn = e.target.closest('.tab-btn');
  if(!btn) return;
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('panel-'+btn.dataset.tab).classList.add('active');
  if(btn.dataset.tab==='library') renderLibrary();
});

/* ==========================================================================
   ĐIỂM ĐẾN ĐƯỜNG BỘ (LAND)
   Hàng xuất đường bộ chỉ đi Lào và Campuchia, nên danh sách gợi ý chỉ gồm các
   thành phố lớn / đầu mối của hai nước này — không lấy từ WORLD_PORTS (danh sách
   đó là cảng biển và sân bay toàn cầu, đưa vào chỉ tổ rối).
   Toạ độ để trống: resolvePortInput sẽ tự tra qua geocoder rồi nhớ lại.
   Tên để nguyên tiếng Anh cho khớp cách geocoder tra cứu, giống mọi mục khác.
   ========================================================================== */
const LAND_CITIES = [
  /* --- Lào --- */
  {name:'Vientiane, Laos',        type:'land', country:'Laos'},
  {name:'Savannakhet, Laos',      type:'land', country:'Laos'},
  {name:'Pakse, Laos',            type:'land', country:'Laos'},
  {name:'Luang Prabang, Laos',    type:'land', country:'Laos'},
  {name:'Thakhek, Laos',          type:'land', country:'Laos'},
  {name:'Paksan, Laos',           type:'land', country:'Laos'},
  {name:'Phonsavan, Laos',        type:'land', country:'Laos'},
  {name:'Vang Vieng, Laos',       type:'land', country:'Laos'},
  {name:'Oudomxay, Laos',         type:'land', country:'Laos'},
  {name:'Luang Namtha, Laos',     type:'land', country:'Laos'},
  {name:'Salavan, Laos',          type:'land', country:'Laos'},
  {name:'Attapeu, Laos',          type:'land', country:'Laos'},
  /* --- Campuchia --- */
  {name:'Phnom Penh, Cambodia',   type:'land', country:'Cambodia'},
  {name:'Siem Reap, Cambodia',    type:'land', country:'Cambodia'},
  {name:'Sihanoukville, Cambodia',type:'land', country:'Cambodia'},
  {name:'Battambang, Cambodia',   type:'land', country:'Cambodia'},
  {name:'Kampong Cham, Cambodia', type:'land', country:'Cambodia'},
  {name:'Kampong Thom, Cambodia', type:'land', country:'Cambodia'},
  {name:'Bavet, Cambodia',        type:'land', country:'Cambodia'},   /* cửa khẩu đối diện Mộc Bài */
  {name:'Poipet, Cambodia',       type:'land', country:'Cambodia'},
  {name:'Svay Rieng, Cambodia',   type:'land', country:'Cambodia'},
  {name:'Takeo, Cambodia',        type:'land', country:'Cambodia'},
  {name:'Kampot, Cambodia',       type:'land', country:'Cambodia'},
  {name:'Kratie, Cambodia',       type:'land', country:'Cambodia'},
  {name:'Stung Treng, Cambodia',  type:'land', country:'Cambodia'},
  {name:'Pursat, Cambodia',       type:'land', country:'Cambodia'},
];

/* Mấy mục trong danh sách gốc bị gắn nhầm là cảng biển nhưng tên rõ ràng là sân
   bay ("... Apt", "... Airport", "... Ap"). Lọc bỏ khi hiển thị danh sách cảng
   biển để khỏi chọn nhầm. Ngoại lệ: "Macapa - Ap" — "Ap" ở đây là mã bang Amapá
   của Brazil chứ không phải airport, và Macapá là cảng sông/biển thật. */
/* Danh sách gốc gắn "cảng biển" cho cả những nước KHÔNG GIÁP BIỂN — 502 mục ở 43
   nước (Afghanistan 28, Nepal 44, Hungary 57, Bolivia 33...). Đó là lý do trước
   đây chọn "Đường biển" vẫn ra được Gardez, Afghanistan — một tuyến không tồn tại.
   Vài nước trong đây có cảng SÔNG thật (Hungary/Áo trên sông Danube, Paraguay/
   Bolivia trên sông Paraná), nhưng hàng container đường biển từ Việt Nam thì
   không bao giờ cập những chỗ đó — luôn phải qua một cảng biển rồi đi tiếp đường
   bộ hoặc đường sắt. Nên bỏ hết khỏi danh sách cảng biển cho gọn và khỏi chọn nhầm.
   Tên quốc gia vẫn chọn được bình thường (Afghanistan, Nepal... vẫn nằm trong
   danh sách quốc gia), chỉ là không còn giả vờ có cảng biển nữa.
   ⚠️ So khớp CHÍNH XÁC cả tên, không dùng "chứa chuỗi" — vì "Niger" (không giáp
   biển) và "Nigeria" (có biển) chỉ khác nhau hai chữ cái. */
const LANDLOCKED_COUNTRIES = {
  'Afghanistan':1,'Andorra':1,'Armenia':1,'Austria':1,'Azerbaijan':1,'Belarus':1,
  'Bhutan':1,'Bolivia':1,'Botswana':1,'Burkina Faso':1,'Burundi':1,
  'Central African Republic':1,'Chad':1,'Czech Republic':1,'Czechia':1,
  'Eswatini':1,'Swaziland':1,'Ethiopia':1,'Hungary':1,'Kazakhstan':1,'Kosovo':1,
  'Kyrgyzstan':1,'Laos':1,'Lesotho':1,'Liechtenstein':1,'Luxembourg':1,'Malawi':1,
  'Mali':1,'Moldova':1,'Mongolia':1,'Nepal':1,'Niger':1,'North Macedonia':1,
  'Macedonia':1,'Paraguay':1,'Rwanda':1,'San Marino':1,'Serbia':1,'Slovakia':1,
  'South Sudan':1,'Switzerland':1,'Tajikistan':1,'Turkmenistan':1,'Uganda':1,
  'Uzbekistan':1,'Vatican City':1,'Zambia':1,'Zimbabwe':1,
};

const AIRPORTISH_RE = /\bApt\b|Airport|\bAp$/i;
const AIRPORTISH_EXCEPTIONS = { 'Macapa - Ap, Brazil': 1 };
function looksLikeAirportName(name){
  if(AIRPORTISH_EXCEPTIONS[name]) return false;
  const beforeComma = String(name).split(',')[0].trim();
  return AIRPORTISH_RE.test(beforeComma);
}

/* portType: 'air' · 'sea' · 'land' · null (chưa chọn loại hình ⇒ hiện tất cả)
   Đường bộ không có "cảng" riêng: điểm đến là THÀNH PHỐ nước bạn (Nam Ninh,
   Côn Minh, Viêng Chăn, Bangkok...). Cùng một thành phố thường nằm hai lần
   trong WORLD_PORTS (một dòng air, một dòng sea), nên với 'land' ta gộp trùng
   theo tên và bỏ luôn nhãn ✈/🚢 vì chúng vô nghĩa với xe tải. */

/* transport mode preset (SEA / AIR / LAND) */
const MODE_TO_PORT_TYPE = { AIR:'air', SEA:'sea', LAND:'land' };
let lkTransportMode = 'SEA';
document.getElementById('lk-mode-presets').addEventListener('click', e=>{
  const btn = e.target.closest('.preset-btn');
  if(!btn) return;
  document.querySelectorAll('#lk-mode-presets .preset-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  lkTransportMode = btn.dataset.mode;
  populatePortDatalist(document.getElementById('lk-port-datalist'), MODE_TO_PORT_TYPE[lkTransportMode] || 'sea');
});
populatePortDatalist(document.getElementById('lk-port-datalist'), 'sea');

/* populate shared country datalist + lookup map (destination-only, so Vietnam is
   excluded from suggestions here too — export cargo never ships back to Vietnam). */
const COUNTRY_BY_NAME = {};
(function(){
  const dl = document.getElementById('country-datalist');
  WORLD_COUNTRIES.forEach(c=>{
    COUNTRY_BY_NAME[c.name] = c; // keep resolvable even though hidden from suggestions
    if(c.name === 'Vietnam') return;
    const opt = document.createElement('option');
    opt.value = c.name;
    dl.appendChild(opt);
  });
})();
function resolveCountryInput(inputEl){
  const val = inputEl.value.trim();
  const hit = COUNTRY_BY_NAME[val];
  return hit ? { name: val, lat: hit.lat, lon: hit.lon } : null;
}

/* populate port/airport datalist (specific seaports & airports worldwide) + country list,
   so the Upload tab can pick an exact port — grouping in Kho dữ liệu still uses the port's
   parent country (see resolvePortInput) so cards don't fragment per-port.
   Vietnam itself is excluded from the visible suggestions here since this list is only
   ever used to pick the DESTINATION — always export cargo, never back to Vietnam.
   The datalist is filtered by transport mode (SEA -> only seaports, AIR -> only airports)
   so picking a destination never suggests the wrong kind of terminal — countries stay
   listed either way since a plain country name isn't mode-specific. */
const PORT_BY_NAME = {};
WORLD_PORTS.forEach(p=>{ PORT_BY_NAME[p.name] = p; });
/* Đăng ký sau WORLD_PORTS: nếu trùng tên thì bản đường bộ được ưu tiên. */
LAND_CITIES.forEach(p=>{ PORT_BY_NAME[p.name] = p; });

/* Một mục có được hiện trong danh sách của loại hình đang chọn hay không. */
function portAllowedFor(p, portType){
  if(p.country === 'Vietnam') return false;
  if(portType && p.type !== portType) return false;
  if(portType === 'sea'){
    if(looksLikeAirportName(p.name)) return false;        /* sân bay bị gắn nhầm loại */
    if(LANDLOCKED_COUNTRIES[p.country]) return false;     /* "cảng biển" ở nước không giáp biển */
  }
  return true;
}
/* Tên QUỐC GIA cũng phải lọc theo loại hình, chứ không chỉ lọc tên cảng: chọn
   "Đường biển" mà vẫn gõ được "Afghanistan" thì vẫn ra tuyến vô lý y như cũ.
   Quy tắc: một quốc gia chỉ xuất hiện nếu nó thực sự còn ít nhất MỘT địa điểm
   hợp lệ của loại hình đó. Nước không giáp biển tự động biến mất khỏi danh sách
   đường biển, và nước không có sân bay nào tự động biến mất khỏi đường hàng không.
   Tính một lần rồi nhớ lại, vì danh sách gốc gần 20.000 mục. Bộ nhớ đệm gắn
   thẳng vào hàm (không dùng const ở ngoài) để tránh lỗi "dùng trước khi khai
   báo" — populatePortDatalist được gọi lần đầu ở phía TRÊN chỗ này. */
function countriesForType(portType){
  const cache = countriesForType._cache || (countriesForType._cache = Object.create(null));
  const key = portType || '_all';
  if(cache[key]) return cache[key];
  const set = Object.create(null);
  WORLD_PORTS.forEach(p=>{ if(portAllowedFor(p, portType)) set[p.country] = 1; });
  cache[key] = set;
  return set;
}

function populatePortDatalist(datalistEl, portType){
  datalistEl.innerHTML = '';
  const add = (value, label)=>{
    const opt = document.createElement('option');
    opt.value = value;
    if(label) opt.label = label;
    datalistEl.appendChild(opt);
  };

  /* LAND: chỉ Lào + Campuchia, danh sách riêng, không đụng tới WORLD_PORTS. */
  if(portType === 'land'){
    LAND_CITIES.forEach(p=>add(p.name, '🚛'));
    add('Laos'); add('Cambodia');
    return;
  }

  WORLD_PORTS.forEach(p=>{
    if(!portAllowedFor(p, portType)) return;
    add(p.name, p.type==='air' ? '✈' : '🚢');
  });
  const allowedCountries = portType ? countriesForType(portType) : null;
  WORLD_COUNTRIES.forEach(c=>{
    if(c.name === 'Vietnam') return;
    if(allowedCountries && !allowedCountries[c.name]) return;
    add(c.name);
  });
}
async function resolvePortInput(inputEl){
  const val = inputEl.value.trim();
  const port = PORT_BY_NAME[val];
  if(port){
    if(port.lat == null || port.lon == null){
      // Official VNACCS port/airport list has no coordinates — resolve live via the
      // existing geocoder (fast known-ports table first, then Open-Meteo geocoding as
      // fallback), then cache on the entry so this only happens once per session.
      const geo = await geocode(port.name);
      if(!geo) return null;
      port.lat = geo.lat; port.lon = geo.lon;
    }
    return { label: port.name, lat: port.lat, lon: port.lon, country: port.country, type: port.type };
  }
  const country = COUNTRY_BY_NAME[val];
  if(country) return { label: country.name, lat: country.lat, lon: country.lon, country: country.name, type: null };
  return null;
}

/* ================= TRANSIT STOPS ================= */
let transitSeq = 0;
function addTransitRow(){
  const id = 'transit-' + (transitSeq++);
  const wrap = document.createElement('div');
  wrap.className = 'transit-row';
  wrap.id = id;
  wrap.innerHTML = `
    <div style="flex:2;">
      <label class="mini">Tên cảng trung chuyển</label>
      <input type="text" class="transit-name" placeholder="VD: Cái Mép, Việt Nam">
    </div>
    <div style="flex:1;">
      <label class="mini">Ngày thứ mấy (tuỳ chọn)</label>
      <input type="number" class="transit-offset" placeholder="Tự ước tính" min="0">
      <div class="hint transit-offset-hint" style="margin-top:4px;"></div>
    </div>
    <div style="flex:1;">
      <label class="mini">Số ngày lưu bãi</label>
      <input type="number" class="transit-dwell" value="2" min="0">
    </div>
    <div>
      <label class="mini">&nbsp;</label>
      <button type="button" class="remove-transit" title="Xoá">✕</button>
    </div>
  `;
  document.getElementById('transit-list').appendChild(wrap);
  wrap.querySelector('.remove-transit').addEventListener('click', ()=>wrap.remove());
}
document.getElementById('btn-add-transit').addEventListener('click', addTransitRow);

function getTransitStops(){
  return Array.from(document.querySelectorAll('.transit-row')).map(row=>{
    const name = row.querySelector('.transit-name').value.trim();
    const offsetRaw = row.querySelector('.transit-offset').value;
    const dwellRaw = row.querySelector('.transit-dwell').value;
    return {
      name,
      offset: offsetRaw==='' ? null : parseFloat(offsetRaw),
      dwell: dwellRaw==='' ? 0 : Math.max(0, parseFloat(dwellRaw)),
    };
  }).filter(t=>t.name);
}

/* ================= UPLOAD FLOW ================= */
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
dropzone.addEventListener('click', ()=>fileInput.click());
['dragover'].forEach(ev=>dropzone.addEventListener(ev, e=>{e.preventDefault(); dropzone.classList.add('drag');}));
['dragleave','drop'].forEach(ev=>dropzone.addEventListener(ev, e=>{e.preventDefault(); dropzone.classList.remove('drag');}));
dropzone.addEventListener('drop', e=>{
  const files = Array.from(e.dataTransfer.files).filter(f=>f.type==='application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
  handleFiles(files);
});
fileInput.addEventListener('change', e=>{
  handleFiles(Array.from(e.target.files));
  fileInput.value = '';
});

function handleFiles(files){
  files.forEach(processFile);
}

async function fileToBase64(file){
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunkSize = 0x8000;
  for(let i=0; i<bytes.length; i+=chunkSize){
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i+chunkSize));
  }
  return btoa(binary);
}
function openPdfFromBase64(base64, fileName){
  try{
    const byteChars = atob(base64);
    const byteNumbers = new Array(byteChars.length);
    for(let i=0; i<byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], {type:'application/pdf'});
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }catch(e){
    console.error('open pdf failed', e);
    toast('Không mở được file PDF gốc (có thể chưa được lưu khi tải lên).');
  }
}
window.openPdfById = async function(id){
  const full = await getShipment(id);
  if(!full || !full.pdfBase64){ toast('Lô này chưa có file PDF gốc được lưu.'); return; }
  openPdfFromBase64(full.pdfBase64, full.fileName);
};

async function processFile(file){
  const cardId = uid();
  const list = document.getElementById('pending-list');
  const card = document.createElement('div');
  card.className = 'pending-card';
  card.innerHTML = `
    <div class="pending-head">
      <span class="fname">${escapeHtml(file.name)}</span>
      <span class="status-chip status-parsing" id="chip-${cardId}"><span class="spinner"></span> Đang đọc PDF…</span>
    </div>
    <div class="pending-body" id="body-${cardId}"></div>
  `;
  list.prepend(card);

  try{
    const parsed = await parsePdf(file);
    document.getElementById('chip-'+cardId).outerHTML = `<span class="status-chip status-ok" id="chip-${cardId}">✓ Đã đọc ${parsed.pointCount} điểm dữ liệu</span>`;
    renderPendingBody(cardId, file, parsed);
  }catch(err){
    document.getElementById('chip-'+cardId).outerHTML = `<span class="status-chip status-error">✕ Lỗi</span>`;
    document.getElementById('body-'+cardId).innerHTML = `<p style="color:var(--danger);font-size:13.5px;">${escapeHtml(err.message || String(err))}</p>`;
  }
}

function renderPendingBody(cardId, file, parsed){
  const body = document.getElementById('body-'+cardId);
  const startD = new Date(parsed.start), stopD = new Date(parsed.stop);
  const tripDays = ((parsed.stop - parsed.start)/86400000).toFixed(1);
  body.innerHTML = `
    <div class="stat-strip">
      <div class="stat-item"><b>${fmt1(parsed.max)}°C</b><span>Cao nhất</span></div>
      <div class="stat-item"><b>${fmt1(parsed.min)}°C</b><span>Thấp nhất</span></div>
      <div class="stat-item"><b>${fmt1(parsed.avg)}°C</b><span>Trung bình</span></div>
      <div class="stat-item"><b>${tripDays}</b><span>Ngày hành trình</span></div>
    </div>
    <div class="ribbon-wrap"><canvas class="ribbon" id="ribbon-${cardId}"></canvas></div>
    <div class="hint" style="margin-bottom:16px;">Từ ${startD.toLocaleString('vi-VN')} đến ${stopD.toLocaleString('vi-VN')} · Các tháng trong hành trình: ${parsed.months.map(m=>MONTH_NAMES[m]).join(', ')}</div>

    <div class="grid-2">
      <div class="field">
        <label class="field-label">Loại hình vận chuyển</label>
        <select id="meta-mode-${cardId}">
          <option value=">— Chọn loại hình —</option>
          <option value="AIR">AIR</option>
          <option value="LAND">LAND (đường bộ)</option>
          <option value="LCL">LCL</option>
          <option value="FCL_COLD">FCL Lạnh</option>
          <option value="FCL_STD">FCL Thường</option>
        </select>
      </div>
      <div class="field">
        <label class="field-label">Cảng / nước đến</label>
        <input type="text" id="meta-dest-${cardId}" list="meta-port-datalist-${cardId}" placeholder="Gõ tên cảng, sân bay hoặc quốc gia...">
        <datalist id="meta-port-datalist-${cardId}"></datalist>
      </div>
    </div>
    <button class="btn btn-primary" id="save-${cardId}">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>
      Lưu vào kho dữ liệu
    </button>
  `;
  requestAnimationFrame(()=>drawRibbon(document.getElementById('ribbon-'+cardId), parsed.points));

  const metaModeSelect = document.getElementById('meta-mode-'+cardId);
  const metaPortDatalist = document.getElementById('meta-port-datalist-'+cardId);
  function refreshMetaPortDatalist(){
    const m = metaModeSelect.value;
    // LCL / FCL_COLD / FCL_STD đều là hàng đường biển ⇒ danh sách cảng biển.
    // Chưa chọn loại hình ⇒ null ⇒ hiện tất cả.
    const portType = m ? (MODE_TO_PORT_TYPE[m] || 'sea') : null;
    populatePortDatalist(metaPortDatalist, portType);
  }
  refreshMetaPortDatalist();
  metaModeSelect.addEventListener('change', refreshMetaPortDatalist);

  document.getElementById('save-'+cardId).addEventListener('click', async ()=>{
    const btn = document.getElementById('save-'+cardId);
    const destInput = document.getElementById('meta-dest-'+cardId);
    const destResolved = await resolvePortInput(destInput);
    const modeSelect = document.getElementById('meta-mode-'+cardId);
    const transportMode = modeSelect.value;
    if(!destResolved){ toast('Gõ tên cảng/sân bay/quốc gia rồi chọn đúng tên trong danh sách gợi ý nhé.'); return; }
    const dest = destResolved.country;
    const destPort = destResolved.type ? destResolved.label : null;

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Đang lưu…';

    const destLat = destResolved.lat, destLon = destResolved.lon;
    const origin = 'Việt Nam';
    const og = await geocode(origin);

    let pdfBase64 = null;
    try{ pdfBase64 = await fileToBase64(file); }
    catch(e){ console.error('pdf to base64 failed', e); }

    const record = {
      id: uid(),
      fileName: file.name,
      deviceId: parsed.deviceId,
      origin, dest, destPort,
      originLat: og?og.lat:null, originLon: og?og.lon:null,
      destLat, destLon,
      transportMode,
      drug: '', reqMin: null, reqMax: null,
      points: parsed.points,
      min: parsed.min, max: parsed.max, avg: parsed.avg,
      start: parsed.start, stop: parsed.stop,
      months: parsed.months,
      uploadedAt: Date.now(),
      pdfBase64,
    };
    await saveShipment(record);
    toast('Đã lưu "'+file.name+'" vào kho dữ liệu.');
    btn.outerHTML = '<span class="status-chip status-saved">✓ Đã lưu vào kho dữ liệu</span>';
  });
}

/* ================= LOOKUP FLOW ================= */
document.getElementById('btn-run-lookup').addEventListener('click', runLookup);

function niceStep(range, targetCount){
  const rough = range/targetCount;
  const mag = Math.pow(10, Math.floor(Math.log10(rough || 1)));
  const norm = rough/mag;
  let step;
  if(norm < 1.5) step = 1;
  else if(norm < 3) step = 2;
  else if(norm < 7) step = 5;
  else step = 10;
  return step*mag;
}

function drawJourneyChart(canvas, journey, reqMin, reqMax){
  const { ambientMax, containerMax, waypoints, totalDays } = journey;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 600, h = canvas.clientHeight || 220;
  canvas.width = w*dpr; canvas.height = h*dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr,dpr);
  ctx.clearRect(0,0,w,h);

  const validVals = [...ambientMax, ...containerMax].filter(v=>v!=null);
  if(!validVals.length) return;
  const allVals = [...validVals];
  if(reqMin!==null && !isNaN(reqMin)) allVals.push(reqMin);
  if(reqMax!==null && !isNaN(reqMax)) allVals.push(reqMax);
  let vmin = Math.min(...allVals), vmax = Math.max(...allVals);
  const pad = (vmax-vmin)*0.22 || 2;
  vmin -= pad; vmax += pad;

  const n = ambientMax.length;
  const leftPad=38, rightPad=8, topPad=14, botPad=28;
  const plotW = w-leftPad-rightPad, plotH = h-topPad-botPad;
  const xAt = i => leftPad + (n<=1?0:(i/(n-1))*plotW);
  const yAt = v => topPad + plotH - ((v-vmin)/(vmax-vmin))*plotH;

  // Y-axis gridlines with numeric labels
  const step = niceStep(vmax-vmin, 4);
  const gridStart = Math.ceil(vmin/step)*step;
  ctx.font = '10px "IBM Plex Mono", monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for(let g=gridStart; g<=vmax; g+=step){
    const py = yAt(g);
    ctx.strokeStyle = 'rgba(231,236,243,.08)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(leftPad, py); ctx.lineTo(leftPad+plotW, py); ctx.stroke();
    ctx.fillStyle = 'rgba(140,160,188,.8)';
    ctx.fillText(Math.round(g)+'°', leftPad-6, py);
  }
  ctx.textBaseline = 'alphabetic';

  if(reqMin!==null && !isNaN(reqMin) && reqMax!==null && !isNaN(reqMax)){
    const yTop=yAt(reqMax), yBot=yAt(reqMin);
    ctx.fillStyle='rgba(103,217,154,0.10)';
    ctx.fillRect(leftPad, yTop, plotW, yBot-yTop);
    ctx.strokeStyle='rgba(103,217,154,.3)'; ctx.setLineDash([3,3]); ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(leftPad,yTop); ctx.lineTo(leftPad+plotW,yTop); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(leftPad,yBot); ctx.lineTo(leftPad+plotW,yBot); ctx.stroke();
    ctx.setLineDash([]);
  }

  waypoints.forEach(wp=>{
    const px = xAt(wp.offset);
    ctx.strokeStyle = wp.type==='transit' ? 'rgba(242,166,90,.55)' : 'rgba(231,236,243,.2)';
    if(wp.type==='transit') ctx.setLineDash([3,3]);
    ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(px, topPad); ctx.lineTo(px, topPad+plotH); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = wp.type==='transit' ? '#F2A65A' : 'rgba(231,236,243,.75)';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = wp.offset < totalDays*0.12 ? 'left' : (wp.offset > totalDays*0.88 ? 'right' : 'center');
    ctx.fillText((wp.name||'').split(',')[0].slice(0,16), px, topPad+plotH+15);
  });

  function line(vals, color, width){
    ctx.beginPath();
    let started=false;
    vals.forEach((v,i)=>{
      if(v==null) return;
      const px=xAt(i), py=yAt(v);
      if(!started){ ctx.moveTo(px,py); started=true; } else ctx.lineTo(px,py);
    });
    ctx.strokeStyle=color; ctx.lineWidth=width; ctx.lineJoin='round'; ctx.lineCap='round'; ctx.stroke();
  }
  line(ambientMax, '#F2A65A', 2);
  line(containerMax, '#FF6E6E', 2.3);

  // numeric value labels at each waypoint, for both lines
  ctx.font = '600 10px "IBM Plex Mono", monospace';
  waypoints.forEach(wp=>{
    const idx = Math.max(0, Math.min(n-1, wp.offset));
    const px = xAt(idx);
    const align = wp.offset < totalDays*0.08 ? 'left' : (wp.offset > totalDays*0.92 ? 'right' : 'center');
    ctx.textAlign = align;
    const cVal = containerMax[idx], aVal = ambientMax[idx];
    if(cVal!=null){
      ctx.fillStyle = '#FF6E6E';
      ctx.fillText(cVal.toFixed(1)+'°', px, yAt(cVal)-8);
    }
    if(aVal!=null){
      ctx.fillStyle = '#F2A65A';
      ctx.fillText(aVal.toFixed(1)+'°', px, yAt(aVal)+16);
    }
  });
}

function drawClimateChart(canvas, tmax, tmin, tmean, reqMin, reqMax){
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 280, h = canvas.clientHeight || 100;
  canvas.width = w*dpr; canvas.height = h*dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr,dpr);
  ctx.clearRect(0,0,w,h);

  const allVals = [...tmax, ...tmin];
  if(reqMin!==null && !isNaN(reqMin)) allVals.push(reqMin);
  if(reqMax!==null && !isNaN(reqMax)) allVals.push(reqMax);
  let vmin = Math.min(...allVals), vmax = Math.max(...allVals);
  const pad = (vmax-vmin)*0.15 || 2;
  vmin -= pad; vmax += pad;
  const n = tmax.length;
  const xAt = i => n<=1 ? 0 : (i/(n-1))*w;
  const yAt = v => h - ((v-vmin)/(vmax-vmin))*h;

  // requirement band (safe zone)
  if(reqMin!==null && !isNaN(reqMin) && reqMax!==null && !isNaN(reqMax)){
    const yTop = yAt(reqMax), yBot = yAt(reqMin);
    ctx.fillStyle = 'rgba(103,217,154,0.10)';
    ctx.fillRect(0, yTop, w, yBot-yTop);
    ctx.strokeStyle = 'rgba(103,217,154,0.35)';
    ctx.setLineDash([3,3]);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0,yTop); ctx.lineTo(w,yTop); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,yBot); ctx.lineTo(w,yBot); ctx.stroke();
    ctx.setLineDash([]);
  }

  function line(vals, color, width){
    ctx.beginPath();
    vals.forEach((v,i)=>{ const px=xAt(i), py=yAt(v); if(i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py); });
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin='round'; ctx.stroke();
  }
  line(tmean, 'rgba(231,236,243,.4)', 1);
  line(tmin, '#5BD9E8', 1.6);
  line(tmax, '#FF8A65', 1.6);
}

async function runLookup(){
  climateFetchHadNetworkError = false;
  const destInput = document.getElementById('lk-dest');
  const etdRaw = document.getElementById('lk-etd').value;
  const etaRaw = document.getElementById('lk-eta').value;
  const origin = 'Việt Nam';
  const drug = '', reqMin = null, reqMax = null;

  const resultsEl = document.getElementById('lookup-results');
  const btn = document.getElementById('btn-run-lookup');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Đang tra cứu…';
  resultsEl.innerHTML = `<div class="empty"><span class="spinner" style="width:20px;height:20px;"></span><div style="margin-top:10px;">Đang xác định vị trí…</div></div>`;

  const destResolved = await resolvePortInput(destInput);
  if(!destResolved){
    toast('Gõ tên cảng/sân bay/quốc gia rồi chọn đúng tên trong danh sách gợi ý nhé.');
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg> Tìm khuyến nghị';
    resultsEl.innerHTML = '';
    return;
  }
  const dest = destResolved.country; // used for matching stored loggers (which store country)
  const destLabel = destResolved.label; // specific port/country name, shown to the user
  if(!etdRaw){
    toast('Chọn ngày đi (ETD) trước đã.');
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg> Tìm khuyến nghị';
    resultsEl.innerHTML = '';
    return;
  }
  const etd = new Date(etdRaw + 'T00:00:00');
  const eta = etaRaw ? new Date(etaRaw + 'T00:00:00') : null;
  const month = etd.getMonth()+1;
  const days = eta ? Math.max(0, Math.round((eta-etd)/86400000)) : 14;

  resultsEl.innerHTML = `<div class="empty"><span class="spinner" style="width:20px;height:20px;"></span><div style="margin-top:10px;">Đang tìm dữ liệu logger và khí hậu lịch sử…</div></div>`;

  try{
    // ---- 1. resolve endpoints: origin is always Vietnam; destination comes straight
    //         from the resolved port/country lookup (no geocoding call needed, always exact) ----
    const og = await geocode(origin);
    const ds = { lat: destResolved.lat, lon: destResolved.lon, label: destLabel };

    // ---- 2. match stored shipments: same destination COUNTRY only (regardless of the
    //         SEA/AIR toggle — real logger data is useful reference either way).
    //         Within that, split by month: exact calendar-month match (any year) shows
    //         directly; anything else is sorted by closeness-in-month but kept collapsed
    //         until the user asks to see it. ----
    const idx = await loadIndex();
    const nDest = norm(dest);
    const sameCountry = idx.filter(rec=>{
      const rDest = norm(rec.dest||'');
      return rDest && (rDest.includes(nDest) || nDest.includes(rDest));
    });
    function monthCircularDist(m1, m2){ const d = Math.abs(m1-m2); return Math.min(d, 12-d); }
    const exact = [], closest = [];
    sameCountry.forEach(rec=>{
      const months = rec.months || [];
      const minDist = months.length ? Math.min(...months.map(m=>monthCircularDist(month,m))) : 99;
      if(minDist === 0) exact.push({...rec});
      else closest.push({...rec, monthDist: minDist});
    });
    closest.sort((a,b)=>a.monthDist-b.monthDist);
    const reference = closest; // kept name for the render/PDF-hydration code below

    await Promise.all([...exact, ...reference].map(async r=>{
      const full = await getShipment(r.id);
      if(full && full.points) r.dayStats = computeDayStats(full.points);
      r.hasPdf = !!(full && full.pdfBase64);
    }));

    // ---- 3. build day-by-day journey: origin -> transit stops -> destination ----
    let journey = null, climateError = null;
    const transitStops = getTransitStops();
    // container-vs-ambient deltas: differ a lot between SEA (long exposure to tropical
    // sun/heat, especially while dwelling in a yard) and AIR (very short overall transit —
    // real heat risk is only during ground handling on the tarmac before departure /
    // after arrival / at a transit stop; the flight itself and any warehouse/customs time
    // in between is assumed climate-controlled, but still loosely tracks the local
    // outdoor climate along the route (a flight over/through a hot region should read
    // hotter than one over a mild region) rather than a single fixed number everywhere.
    // Dwell offsets are intentionally large: a sealed container/pallet sitting still in
    // direct sun ("greenhouse effect") commonly runs 10–15°C above outdoor ambient —
    // moving cargo gets some cooling from airflow/wind, so that offset stays much smaller.
    const OFFSET_PRESETS = {
      SEA:  {transit: 5,  dwell: 12, min: 1},
      AIR:  {transit: 1,  dwell: 10, min: -1},
      /* Đường bộ nằm giữa hai loại trên. Thùng xe tải kín phơi nắng nóng nhanh
         và mạnh gần bằng container biển, nhưng hành trình ngắn hơn nhiều và ban
         đêm xe chạy nên hạ nhiệt tốt hơn. Rủi ro lớn nhất của đường bộ là lúc
         ĐỖ CHỜ: chờ thông quan ở cửa khẩu, nghỉ trưa, chờ giao hàng — xe tắt
         máy, tắt lạnh, đứng giữa nắng. */
      LAND: {transit: 4,  dwell: 8, min: 2},
    };
    const preset = OFFSET_PRESETS[lkTransportMode] || OFFSET_PRESETS.SEA;
    const offsetTransit = preset.transit, offsetMinC = preset.min;
    const isAir = lkTransportMode === 'AIR';
    const isLand = lkTransportMode === 'LAND';
    // The greenhouse-effect heat gain of a sun-exposed shipment scales with how intense
    // the sun/heat actually is that day for BOTH SEA and AIR — but the ceiling is lower
    // for AIR: cargo only dwells on the tarmac for a few hours (not days) and is often
    // netted rather than fully sealed, so even in harsh summer sun it builds up
    // noticeably less excess heat than a sealed steel sea container would.
    function dwellOffsetForWeather(ambientMaxC){
      if(ambientMaxC == null) return preset.dwell;
      if(isAir){
        if(ambientMaxC < 20) return 2;   // mát/mùa đông
        if(ambientMaxC < 33) return 3;   // hè bình thường / thu
        return 5;                        // hè nắng gắt
      }
      if(isLand){
        // Đường bộ chỉ đi Lào và Campuchia — hai nước này chung nền nhiệt với
        // Việt Nam, KHÔNG có mùa đông lạnh thật. "Mùa mát" ở đây vẫn 22-28°C,
        // nên mốc chia phải cao hơn hẳn hàng biển/hàng air (vốn đi khắp thế giới,
        // có cả châu Âu mùa đông dưới 10°C). Để mốc <20°C thì gần như không bao
        // giờ chạm tới, mọi chuyến đều bị tính theo mức nóng nhất.
        if(ambientMaxC < 25) return 5;   // mùa mát (khoảng tháng 11-2)
        if(ambientMaxC < 33) return 6;   // chuyển mùa
        return 8;                        // mùa nóng, đỗ chờ thông quan giữa trưa
      }
      if(ambientMaxC < 20) return 3;   // mát/mùa đông
      if(ambientMaxC < 33) return 7;   // hè bình thường / thu
      return 11;                       // hè nắng gắt
    }
    const totalDays = days > 0 ? days : 14;

    if(og && ds){
      const transitGeo = await Promise.all(transitStops.map(t=>geocode(t.name)));
      // AIR: origin & destination each get a default 1-day ground-handling dwell
      // (tarmac exposure before departure / after arrival) since that's the real
      // heat risk window for air freight — the rest of the timeline is assumed
      // to be in-flight or in a climate-controlled facility.
      const groundDwell = isAir ? 1 : 0;
      const rawWaypoints = [
        {type:'origin', name: origin, lat:og.lat, lon:og.lon, offset:0, dwell:groundDwell},
        ...transitStops.map((t,i)=>({
          type:'transit', name: t.name,
          lat: transitGeo[i]?transitGeo[i].lat:null, lon: transitGeo[i]?transitGeo[i].lon:null,
          offset: t.offset, dwell: t.dwell,
        })).filter(w=>w.lat!=null),
        {type:'dest', name: destLabel, lat:ds.lat, lon:ds.lon, offset: totalDays, dwell:groundDwell},
      ];
      // For any transit stop without an explicit day number, estimate its day
      // proportionally to real sailing/flying distance (origin -> stops in the order
      // added -> destination), rather than just spacing them evenly by count. This is
      // still a rough estimate (no real vessel/flight schedule data), but tracks reality
      // much better — e.g. a transit port very close to the origin lands early in the
      // timeline instead of being pushed to the middle.
      const legDists = [];
      for(let i=0; i<rawWaypoints.length-1; i++){
        legDists.push(haversine(rawWaypoints[i].lat, rawWaypoints[i].lon, rawWaypoints[i+1].lat, rawWaypoints[i+1].lon));
      }
      const totalDist = legDists.reduce((a,b)=>a+b,0) || 1;
      let cumDist = 0;
      for(let i=1; i<rawWaypoints.length; i++){
        cumDist += legDists[i-1];
        const w = rawWaypoints[i];
        if(w.type==='transit' && w.offset===null){
          w.offset = Math.round(totalDays * (cumDist/totalDist));
        }
      }
      rawWaypoints.forEach(w=>{ w.offset = Math.max(0, Math.min(totalDays, w.offset)); });
      const waypoints = rawWaypoints.sort((a,b)=>a.offset-b.offset);

      // Show the computed estimate back in each transit row (informational only —
      // does not overwrite the input's actual value, so it stays "auto" next search
      // unless the user explicitly types a day number themselves).
      document.querySelectorAll('.transit-row').forEach(row=>{
        const nameVal = row.querySelector('.transit-name').value.trim();
        const hintEl = row.querySelector('.transit-offset-hint');
        const offsetInput = row.querySelector('.transit-offset');
        if(!hintEl) return;
        const match = waypoints.find(w=>w.type==='transit' && w.name===nameVal);
        if(match){
          hintEl.textContent = offsetInput.value.trim()===''
            ? `≈ ngày thứ ${match.offset} (tự ước tính theo khoảng cách)`
            : `Dùng đúng ngày ${match.offset} bạn nhập`;
        }else{
          hintEl.textContent = '';
        }
      });

      const depDate = etd;

      await Promise.all(waypoints.map(async w=>{
        const wDate = new Date(depDate.getTime() + w.offset*86400000);
        const m = wDate.getMonth()+1;
        const y = pickYearForMonth(m);
        w.clim = await fetchMonthClimate(w.lat, w.lon, y, m);
        w.month = m; w.yearUsed = y;
      }));

      const dayDates=[], ambientMax=[], ambientMin=[], containerMax=[], containerMin=[];
      for(let d=0; d<=totalDays; d++){
        let L = waypoints[0], R = waypoints[waypoints.length-1];
        for(let i=0;i<waypoints.length-1;i++){
          if(d >= waypoints[i].offset && d <= waypoints[i+1].offset){ L = waypoints[i]; R = waypoints[i+1]; break; }
        }
        const span = (R.offset - L.offset) || 1;
        const wR = (R===L) ? 0 : (d - L.offset)/span;
        const wL = 1 - wR;

        const sample = (w, arr) => (!w || !w.clim || !arr || !arr.length) ? null : arr[((d % arr.length)+arr.length)%arr.length];
        const lMax = sample(L, L.clim&&L.clim.tmax), rMax = sample(R, R.clim&&R.clim.tmax);
        const lMin = sample(L, L.clim&&L.clim.tmin), rMin = sample(R, R.clim&&R.clim.tmin);
        const lMean = sample(L, L.clim&&L.clim.tmean), rMean = sample(R, R.clim&&R.clim.tmean);
        let amMax = (lMax!=null && rMax!=null) ? (wL*lMax+wR*rMax) : (lMax!=null?lMax:rMax);
        let amMin = (lMin!=null && rMin!=null) ? (wL*lMin+wR*rMin) : (lMin!=null?lMin:rMin);
        const amMean = (lMean!=null && rMean!=null) ? (wL*lMean+wR*rMean) : (lMean!=null?lMean:rMean);

        let inDwell = false;
        waypoints.forEach(w=>{ if(w.dwell>0 && d>=w.offset && d<w.offset+w.dwell) inDwell=true; });

        // During a real ground-dwell window (container/pallet sitting exposed to sun at
        // a port yard or airport tarmac), use the TRUE statistical peak (hiMax) of that
        // location's fetched month instead of an arbitrarily cycled day — this is
        // specifically the highest-risk moment, so it should reflect the worst realistic
        // day that location sees that month, not a random sample that might land on a
        // mild day and understate the risk.
        if(inDwell){
          const lHi = L.clim && L.clim.hiMax, rHi = R.clim && R.clim.hiMax;
          const hiInterp = (lHi!=null && rHi!=null) ? (wL*lHi+wR*rHi) : (lHi!=null?lHi:rHi);
          if(hiInterp!=null) amMax = hiInterp;
        }

        // For AIR, ground-dwell days (tarmac at origin/transit/destination) use the real
        // daily PEAK outdoor temperature (direct sun on the ramp). Days in between (in
        // flight or in a climate-controlled cargo terminal) use the real daily AVERAGE
        // outdoor temperature for that leg of the route instead — this still reflects
        // where the shipment actually is (a route through Africa reads hot, one through
        // Northern Europe reads mild) without assuming full outdoor peak exposure.
        if(isAir && !inDwell && amMean!=null){
          amMax = amMean;
          amMin = amMean;
        }

        const bonus = inDwell ? dwellOffsetForWeather(amMax) : offsetTransit;

        ambientMax.push(amMax); ambientMin.push(amMin);
        containerMax.push(amMax!=null ? amMax+bonus : null);
        containerMin.push(amMin!=null ? amMin+offsetMinC : null);
        dayDates.push(new Date(depDate.getTime() + d*86400000));
      }

      journey = { waypoints, dayDates, ambientMax, ambientMin, containerMax, containerMin, totalDays, isAir, isLand };
    }else if(!og || !ds){
      climateError = 'Không định vị được toạ độ cho tuyến này. Hãy chọn lại quốc gia đến.';
    }

    renderLookupResults({origin, dest, month, days, drug, reqMin, reqMax, exact, reference, journey, climateError, og, ds});
  }catch(e){
    console.error(e);
    resultsEl.innerHTML = `<div class="empty">Có lỗi khi tra cứu: ${escapeHtml(e.message||String(e))}</div>`;
  }finally{
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg> Tìm khuyến nghị';
  }
}

function renderLookupResults(ctx){
  const { origin, dest, month, days, drug, reqMin, reqMax, exact, reference, journey, climateError } = ctx;
  const resultsEl = document.getElementById('lookup-results');
  let html = '';

  // ---- compute journey-based stats (container estimate drives the recommendation) ----
  let jStats = null;
  if(journey){
    const cMax = journey.containerMax.filter(v=>v!=null);
    const cMin = journey.containerMin.filter(v=>v!=null);
    const aMax = journey.ambientMax.filter(v=>v!=null);
    const aMin = journey.ambientMin.filter(v=>v!=null);
    if(cMax.length && cMin.length){
      jStats = {
        contMax: Math.max(...cMax), contMin: Math.min(...cMin),
        ambMax: Math.max(...aMax), ambMin: Math.min(...aMin),
        over30: journey.containerMax.filter(v=>v!=null&&v>30).length,
        over35: journey.containerMax.filter(v=>v!=null&&v>35).length,
        over40: journey.containerMax.filter(v=>v!=null&&v>40).length,
        totalDays: journey.totalDays,
      };
    }
  }

  // ---- overall banner: prefer exact real-data match, else journey/container estimate ----
  let bannerHtml = '';
  if(exact.length){
    const worstMin = Math.min(...exact.map(r=>r.min));
    const worstMax = Math.max(...exact.map(r=>r.max));
    const rec = recommend(reqMin, reqMax, worstMin, worstMax);
    bannerHtml = verdictBlock(rec, worstMin, worstMax, reqMin, reqMax, `${exact.length} lô data logger thực tế đã lưu cho tuyến này`);
  }else if(jStats){
    const rec = recommend(reqMin, reqMax, jStats.contMin, jStats.contMax);
    const sourceLabel = journey.isAir ? 'dự đoán nhiệt độ lô hàng lúc ở mặt đất theo hành trình'
      : (journey.isLand ? 'dự đoán nhiệt độ trong thùng xe theo hành trình' : 'dự đoán nhiệt độ trong container theo hành trình');
    bannerHtml = verdictBlock(rec, jStats.contMin, jStats.contMax, reqMin, reqMax, sourceLabel + ' (chưa có data logger thực tế trùng khớp)');
  }
  if(!bannerHtml){
    bannerHtml = `<div class="verdict borderline"><div class="verdict-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg></div><div><h2>Chưa đủ dữ liệu để khuyến nghị</h2><p>${climateError || 'Chưa có data logger phù hợp và chưa xác định được toạ độ khí hậu. Hãy kiểm tra lại tên cảng hoặc chọn tháng khởi hành.'}</p></div></div>`;
  }
  html += bannerHtml;

  // ---- section: real data logger matches ----
  html += `<div class="section-label"><span class="dot"></span><h3>Dữ liệu logger thực tế</h3><small>${exact.length} khớp đúng tháng · ${reference.length} tháng khác</small></div>`;
  if(!exact.length && !reference.length){
    html += `<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v16"/></svg><div>Chưa có data logger nào cho quốc gia ${escapeHtml(dest)}. Hãy dựa vào dự đoán khí hậu bên dưới, hoặc tải thêm data logger cho tuyến này.</div></div>`;
  }else{
    function cardHtml(r, ex){
      const tripDays = ((r.stop-r.start)/86400000).toFixed(0);
      const monthNote = !ex ? `<div class="hint" style="margin-top:6px;">Dữ liệu thuộc ${(r.months||[]).map(m=>MONTH_NAMES[m]).join(', ')} — khác tháng bạn đang tra (${MONTH_NAMES[month]}), dùng để tham khảo.</div>` : '';
      return `<div class="match-card">
        <div class="match-head">
          <div>
            <div class="match-route">${escapeHtml(r.origin||'?')}<span class="arrow">→</span>${escapeHtml(r.destPort||r.dest||'?')}</div>
            <div class="match-meta">${new Date(r.start).toLocaleDateString('vi-VN')} – ${new Date(r.stop).toLocaleDateString('vi-VN')} · ${tripDays} ngày ${r.transportMode?(' · '+transportModeLabel(r.transportMode)):''} · ${escapeHtml(r.fileName)}</div>
          </div>
          <span class="tag ${ex?'tag-exact':'tag-ref'}">${ex?'Khớp tháng':'Tháng khác'}</span>
        </div>
        <div class="stat-strip" style="margin-top:14px;margin-bottom:6px;">
          <div class="stat-item"><b>${fmt1(r.max)}°C</b><span>Cao nhất</span></div>
          <div class="stat-item"><b>${fmt1(r.min)}°C</b><span>Thấp nhất</span></div>
          <div class="stat-item"><b>${fmt1(r.avg)}°C</b><span>Trung bình</span></div>
        </div>
        ${r.dayStats ? `<div class="leg-grid" style="grid-template-columns:repeat(3,1fr);margin:10px 0 4px;">
          <div class="leg-card" style="padding:11px 13px;">
            <div class="leg-row" style="border-top:none;"><span>Ngày &gt;30°C</span><b>${r.dayStats.over30}/${r.dayStats.totalDays}</b></div>
            <div class="leg-row"><span>Liên tục dài nhất</span><b>${r.dayStats.streak30} ngày</b></div>
          </div>
          <div class="leg-card" style="padding:11px 13px;">
            <div class="leg-row" style="border-top:none;"><span>Ngày &gt;35°C</span><b>${r.dayStats.over35}/${r.dayStats.totalDays}</b></div>
            <div class="leg-row"><span>Liên tục dài nhất</span><b>${r.dayStats.streak35} ngày</b></div>
          </div>
          <div class="leg-card" style="padding:11px 13px;">
            <div class="leg-row" style="border-top:none;"><span>Ngày &gt;40°C</span><b>${r.dayStats.over40}/${r.dayStats.totalDays}</b></div>
            <div class="leg-row"><span>Liên tục dài nhất</span><b>${r.dayStats.streak40} ngày</b></div>
          </div>
        </div>` : ''}
        ${monthNote}
        <div style="display:flex;gap:8px;margin-top:10px;">
          <button class="btn btn-ghost btn-sm" onclick="openDetail('${r.id}')">Xem chi tiết &amp; biểu đồ</button>
          ${r.hasPdf ? `<button class="btn btn-ghost btn-sm" onclick="openPdfById('${r.id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg> Xem file PDF</button>` : ''}
        </div>
      </div>`;
    }
    exact.forEach(r=>{ html += cardHtml(r, true); });
    if(!exact.length && reference.length){
      html += `<div class="empty">Không có data logger nào đúng tháng ${MONTH_NAMES[month]} cho ${escapeHtml(dest)}.</div>`;
    }
    if(reference.length){
      html += `<button type="button" class="btn btn-ghost btn-sm" id="btn-toggle-closest" style="margin:6px 0 4px;">Xem ${reference.length} lô gần thời gian này (khác tháng) ▾</button>
      <div id="closest-loggers" style="display:none;margin-top:10px;">${reference.map(r=>cardHtml(r,false)).join('')}</div>`;
    }
  }

  // ---- section: journey climate + shipment temperature estimate chart ----
  const cargoTerm = journey && journey.isAir ? 'lô hàng' : (journey && journey.isLand ? 'thùng xe' : 'container');
  const cargoLineLabel = journey && journey.isAir ? 'Nhiệt độ lô hàng lúc ở mặt đất (ước tính)'
    : (journey && journey.isLand ? 'Nhiệt độ trong thùng xe (ước tính)' : 'Nhiệt độ trong container (ước tính)');
  html += `<div class="section-label"><span class="dot" style="background:var(--amber);box-shadow:0 0 8px var(--amber);"></span><h3>Dự đoán nhiệt độ theo hành trình</h3><small>Nguồn: khí hậu lịch sử Open-Meteo + ước tính chênh lệch ${cargoTerm}</small></div>`;
  if(climateError){
    html += `<div class="empty">${escapeHtml(climateError)}</div>`;
  }else if(!month){
    html += `<div class="empty">Chọn tháng khởi hành để xem dự đoán theo hành trình.</div>`;
  }else if(journey && jStats){
    html += `<div class="journey-chart-card">
      <canvas id="journey-chart" style="width:100%;height:220px;display:block;"></canvas>
      <div class="journey-legend">
        <span><i style="background:#F2A65A"></i> Nhiệt độ ngoài trời (đỉnh/ngày)</span>
        <span><i style="background:#FF6E6E"></i> ${escapeHtml(cargoLineLabel)}</span>
        <span><i style="background:var(--safe);opacity:.5;"></i> Vùng ngưỡng bảo quản yêu cầu</span>
        <span style="color:var(--amber)">┊ vạch cam = ${journey && journey.isAir ? 'sân bay đi/đến/trung chuyển' : (journey && journey.isLand ? 'điểm dừng/cửa khẩu' : 'cảng trung chuyển')}</span>
      </div>
    </div>
    <div class="journey-stats">
      <div class="journey-stat ${jStats.contMax > (reqMax??999) ? 'warn':''}"><b>${fmt1(jStats.contMax)}°C</b><span>Cao nhất ${cargoTerm}</span></div>
      <div class="journey-stat"><b>${fmt1(jStats.contMin)}°C</b><span>Thấp nhất ${cargoTerm}</span></div>
      <div class="journey-stat"><b>${fmt1(jStats.ambMax)}°C</b><span>Cao nhất ngoài trời</span></div>
      <div class="journey-stat"><b>${fmt1(jStats.ambMin)}°C</b><span>Thấp nhất ngoài trời</span></div>
      <div class="journey-stat ${jStats.over30>0?'warn':''}"><b>${jStats.over30}/${jStats.totalDays+1}</b><span>Ngày &gt;30°C</span></div>
      <div class="journey-stat ${jStats.over35>0?'warn':''}"><b>${jStats.over35}/${jStats.totalDays+1}</b><span>Ngày &gt;35°C</span></div>
      <div class="journey-stat ${jStats.over40>0?'warn':''}"><b>${jStats.over40}/${jStats.totalDays+1}</b><span>Ngày &gt;40°C</span></div>
    </div>
    ${journey.isLand
      ? `<div class="footnote">* Với LAND (chỉ áp dụng cho tuyến đi Lào và Campuchia): đường "ngoài trời" lấy nhiệt độ đỉnh trong ngày theo khí hậu lịch sử, nội suy dọc tuyến đường bộ (điểm đi → điểm dừng/cửa khẩu → điểm đến). Đường "trong thùng xe" = ngoài trời + độ chênh do thùng kín phơi nắng, **tự tăng theo mức nắng thật của từng ngày dừng đỗ** (mùa mát dưới 25°C: +5°C; chuyển mùa 25-33°C: +6°C; mùa nóng trên 33°C: +8°C). Mốc chia đặt cao hơn hàng biển/hàng air vì Lào và Campuchia chung nền nhiệt với Việt Nam, không có mùa đông lạnh thật — "mùa mát" ở đây vẫn 22-28°C. Lúc xe đang chạy thì chênh ít hơn (+4°C) nhờ gió lùa và chạy đêm. **Rủi ro lớn nhất của đường bộ là lúc đỗ chờ** — chờ thông quan ở cửa khẩu, nghỉ trưa, chờ giao hàng: xe tắt máy là tắt luôn hệ thống lạnh. Đây là ước tính kỹ thuật, không phải số đo thật — ưu tiên dùng data logger thực tế khi có.</div>`
      : journey.isAir
      ? `<div class="footnote">* Với AIR: những ngày lô hàng thực sự nằm ở mặt đất (chờ ở sân bay đi/đến, hoặc trung chuyển) dùng nhiệt độ **đỉnh trong ngày** ngoài trời thật (phơi nắng trực tiếp trên bãi), cộng thêm độ chênh nhà kính **tự tăng theo mức nắng** (dưới 20°C: +2°C; 20-33°C: +3°C; trên 33°C nắng gắt: +5°C) — mức trần thấp hơn hàng biển vì hàng air chỉ nằm bãi vài giờ, không kín tuyệt đối như container. Những ngày còn lại (đang bay, hoặc nằm kho/thủ tục hải quan) dùng nhiệt độ **trung bình trong ngày** ngoài trời thật tại đúng vị trí trên hành trình (không phải số cố định — bay qua vùng nóng vẫn ra nhiệt độ cao hơn bay qua vùng ôn đới). Đây vẫn là ước tính kỹ thuật, không phải số đo thật — ưu tiên dùng data logger thực tế khi có.</div>`
      : `<div class="footnote">* Đường "ngoài trời" lấy nhiệt độ đỉnh trong ngày theo dữ liệu khí hậu lịch sử (nội suy dọc theo các điểm: cảng đi → cảng trung chuyển → cảng đến, năm gần nhất có đủ dữ liệu). Đường "trong container" = ngoài trời + độ chênh do hiệu ứng nhà kính khi container kín phơi nắng — độ chênh này **tự tăng theo cường độ nắng thật của từng ngày lưu bãi** (dưới 20°C ngoài trời: +3°C; 20-33°C: +7°C; trên 33°C nắng gắt: +11°C), lúc đang di chuyển có gió lùa thì chênh ít hơn (+5°C). Đây là ước tính kỹ thuật dựa theo hiệu ứng vật lý thường gặp, không phải số đo thật — ưu tiên dùng data logger thực tế khi có.</div>`}`;
  }else{
    html += climateFetchHadNetworkError
      ? `<div class="empty">Không kết nối được tới dịch vụ dữ liệu khí hậu (Open-Meteo) sau ${3} lần thử — có thể do dịch vụ đang gián đoạn tạm thời hoặc mạng chập chờn.<br><button type="button" class="btn btn-primary btn-sm" style="margin-top:10px;" id="btn-retry-climate">↻ Thử lại</button></div>`
      : `<div class="empty">Không đủ dữ liệu khí hậu cho hành trình này.</div>`;
  }

  resultsEl.innerHTML = html;
  const retryBtn = document.getElementById('btn-retry-climate');
  if(retryBtn) retryBtn.addEventListener('click', runLookup);
  const toggleBtn = document.getElementById('btn-toggle-closest');
  if(toggleBtn){
    toggleBtn.addEventListener('click', ()=>{
      const box = document.getElementById('closest-loggers');
      const showing = box.style.display !== 'none';
      box.style.display = showing ? 'none' : 'block';
      toggleBtn.innerHTML = toggleBtn.innerHTML.replace(showing?'▴':'▾', showing?'▾':'▴');
    });
  }
  if(journey && jStats){
    requestAnimationFrame(()=>{
      const canvas = document.getElementById('journey-chart');
      if(canvas) drawJourneyChart(canvas, journey, reqMin, reqMax);
    });
  }
}

/* ================= LIBRARY ================= */
function transportModeLabel(m){
  return {AIR:'✈ AIR', LAND:'🚛 LAND', LCL:'📦 LCL', FCL_COLD:'❄ FCL Lạnh', FCL_STD:'🚢 FCL Thường'}[m] || '';
}
function transportModeShort(m){
  return {AIR:'AIR', LAND:'LAND', LCL:'LCL', FCL_COLD:'FCL Lạnh', FCL_STD:'FCL Thường'}[m] || '';
}

/* ==========================================================================
   DỰNG LẠI MỤC LỤC KHO DỮ LIỆU
   Lô hàng được lưu thành HAI phần: nội dung đầy đủ ở collection coldroute_shared
   (doc "shipment:<id>") và một dòng mục lục ở collection shipments_meta. Tab
   "Kho dữ liệu" đọc mục lục. Nếu Firestore Rules thiếu quyền cho shipments_meta
   thì phần ghi mục lục bị từ chối lặng lẽ ⇒ dữ liệu vẫn còn nguyên nhưng kho
   trông như trống rỗng. Nút này quét lại coldroute_shared và dựng lại mục lục.
   ========================================================================== */
async function rebuildIndexFromShipments(){
  if(!HAS_FIREBASE || !fsDb) throw new Error('Chỉ dùng được khi đang chạy với Firebase.');
  const snap = await fsDb.collection(FS_COLLECTION).get();
  let scanned = 0, restored = 0, failed = 0;
  for(const doc of snap.docs){
    if(!doc.id.startsWith('shipment:')) continue;   /* bỏ qua các key khác */
    scanned++;
    let rec = null;
    try{
      const raw = doc.data().value;
      rec = typeof raw === 'string' ? JSON.parse(raw) : raw;
    }catch(e){ failed++; continue; }
    if(!rec || !rec.id){ failed++; continue; }
    const ok = await saveIndexEntry({
      id: rec.id, fileName: rec.fileName,
      origin: rec.origin, dest: rec.dest, destPort: rec.destPort,
      originLat: rec.originLat, originLon: rec.originLon,
      destLat: rec.destLat, destLon: rec.destLon,
      drug: rec.drug, reqMin: rec.reqMin, reqMax: rec.reqMax,
      deviceId: rec.deviceId, transportMode: rec.transportMode,
      start: rec.start, stop: rec.stop,
      min: rec.min, max: rec.max, avg: rec.avg,
      months: rec.months, uploadedAt: rec.uploadedAt
    });
    if(ok) restored++; else failed++;
  }
  return { scanned, restored, failed };
}

document.getElementById('btn-rebuild-index').addEventListener('click', async ()=>{
  const btn = document.getElementById('btn-rebuild-index');
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Đang quét…';
  try{
    const r = await rebuildIndexFromShipments();
    await renderLibrary();
    if(r.scanned === 0){
      toast('Không tìm thấy lô nào trong kho gốc — có thể chưa lô nào lưu được lên Firebase.');
    }else if(r.failed){
      toast('Đã dựng lại ' + r.restored + '/' + r.scanned + ' lô. ' + r.failed + ' lô lỗi — mở F12 > Console xem chi tiết.');
    }else{
      toast('Đã dựng lại danh sách: ' + r.restored + ' lô.');
    }
  }catch(e){
    console.error('rebuild index failed', e);
    toast('Dựng lại thất bại: ' + (e.code || e.message) + '. Nhiều khả năng Firestore Rules chưa cho ghi collection "shipments_meta".');
  }finally{
    btn.disabled = false;
    btn.innerHTML = old;
  }
});

document.getElementById('btn-backup').addEventListener('click', async ()=>{
  const btn = document.getElementById('btn-backup');
  const idx = await loadIndex();
  if(!idx.length){ toast('Chưa có dữ liệu nào để backup.'); return; }
  btn.disabled = true;
  const originalHtml = btn.innerHTML;
  try{
    const records = [];
    for(let i=0; i<idx.length; i++){
      btn.innerHTML = `<span class="spinner"></span> Đang tải ${i+1}/${idx.length}…`;
      const full = await getShipment(idx[i].id);
      if(full) records.push(full);
    }
    const payload = {
      exportedAt: new Date().toISOString(),
      appVersion: 'tuyen-lanh-v1',
      count: records.length,
      shipments: records,
    };
    const blob = new Blob([JSON.stringify(payload)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0,10);
    a.href = url;
    a.download = `tuyen-lanh-backup-${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast(`Đã tải backup ${records.length} lô dữ liệu về máy.`);
  }catch(e){
    console.error('backup failed', e);
    toast('Có lỗi khi tạo file backup.');
  }finally{
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
});

async function renderLibrary(){
  const el = document.getElementById('library-list');
  const idx = await loadIndex();
  if(!idx.length){
    el.innerHTML = `<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v16"/></svg><div>Chưa có dữ liệu nào. Sang tab "Tải lên dữ liệu" để bắt đầu.</div></div>`;
    return;
  }

  // group by destination country (normalized), keep the most recent raw label for display
  const groups = new Map();
  idx.forEach(r=>{
    const key = norm(r.dest || 'khac');
    if(!groups.has(key)) groups.set(key, {label: r.dest || 'Khác', items: []});
    groups.get(key).items.push(r);
  });
  const groupList = Array.from(groups.values());
  const now = Date.now();
  const closest = r => Math.abs(now - r.stop);
  groupList.forEach(g=>g.items.sort((a,b)=> closest(a)-closest(b)));
  groupList.sort((a,b)=> Math.min(...a.items.map(closest)) - Math.min(...b.items.map(closest)));

  el.innerHTML = `<div class="lib-grid">` + groupList.map(g=>{
    const allMax = g.items.map(r=>r.max), allMin = g.items.map(r=>r.min);
    const modeCounts = {};
    g.items.forEach(r=>{ const m=r.transportMode||'—'; modeCounts[m]=(modeCounts[m]||0)+1; });
    const modeSummary = Object.entries(modeCounts).map(([m,c])=>`${m==='—'?'Chưa gắn loại':transportModeLabel(m)} ×${c}`).join(' · ');
    return `<div class="lib-card" style="cursor:pointer;" onclick="openCountryGroup('${escapeHtml(norm(g.label)).replace(/'/g,"\\'")}')">
      <div class="route">${escapeHtml(g.label)}</div>
      <div class="period">${g.items.length} lô data logger · ${modeSummary}</div>
      <div class="stat-strip" style="gap:16px;">
        <div class="stat-item"><b>${fmt1(Math.max(...allMax))}°</b><span>Max toàn bộ</span></div>
        <div class="stat-item"><b>${fmt1(Math.min(...allMin))}°</b><span>Min toàn bộ</span></div>
      </div>
      <div class="lib-foot">
        <button class="btn btn-ghost btn-sm">Xem tất cả lô →</button>
      </div>
    </div>`;
  }).join('') + `</div>`;
}

window.openCountryGroup = async function(groupKey){
  const idx = await loadIndex();
  const now = Date.now();
  const allItems = idx.filter(r=>norm(r.dest||'khac')===groupKey);
  if(!allItems.length) return;
  const label = allItems[0].dest || 'Khác';

  function rowHtml(r){
    const tripDays = ((r.stop-r.start)/86400000).toFixed(0);
    const modeSuffix = r.transportMode ? ` (${transportModeShort(r.transportMode)})` : '';
    const destLabel = r.destPort || r.dest || '?';
    return `<div class="match-card" style="margin-bottom:10px;">
      <div class="match-head">
        <div>
          <div class="match-route">${escapeHtml(r.origin||'Việt Nam')}<span class="arrow">→</span>${escapeHtml(destLabel)}${escapeHtml(modeSuffix)}</div>
          <div class="match-meta">${new Date(r.start).toLocaleDateString('vi-VN')} – ${new Date(r.stop).toLocaleDateString('vi-VN')} · ${tripDays} ngày · ${escapeHtml(r.fileName)}</div>
        </div>
      </div>
      <div class="stat-strip" style="margin-top:12px;margin-bottom:4px;">
        <div class="stat-item"><b>${fmt1(r.max)}°C</b><span>Cao nhất</span></div>
        <div class="stat-item"><b>${fmt1(r.min)}°C</b><span>Thấp nhất</span></div>
        <div class="stat-item"><b>${fmt1(r.avg)}°C</b><span>Trung bình</span></div>
      </div>
      <div class="lib-foot" style="margin-top:8px;">
        <button class="btn btn-ghost btn-sm" onclick="openDetail('${r.id}')">Xem chi tiết &amp; biểu đồ</button>
        ${isAdmin ? `<button class="btn btn-danger btn-sm" onclick="removeShipmentFromGroup('${r.id}','${groupKey.replace(/'/g,"\\'")}')">Xoá</button>` : ''}
      </div>
    </div>`;
  }

  function sectionHtml(titleHtml, dotColor, list){
    if(!list.length) return '';
    return `<div class="section-label" style="margin-top:22px;">
      <span class="dot" style="background:${dotColor}"></span>
      <h3>${titleHtml}</h3>
      <small>${list.length} lô</small>
    </div>
    ${list.map(rowHtml).join('')}`;
  }

  function render(){
    const fromRaw = document.getElementById('lib-filter-from').value;
    const toRaw = document.getElementById('lib-filter-to').value;
    let items = allItems;
    if(fromRaw){
      const fromT = new Date(fromRaw+'T00:00:00').getTime();
      items = items.filter(r=>r.stop >= fromT);
    }
    if(toRaw){
      const toT = new Date(toRaw+'T23:59:59').getTime();
      items = items.filter(r=>r.start <= toT);
    }
    items = items.slice().sort((a,b)=> Math.abs(now-a.stop) - Math.abs(now-b.stop));

    /* Trước đây gom "mọi thứ không phải AIR" vào đường biển — thêm LAND thì
       lô đường bộ sẽ bị xếp nhầm vào mục đường biển, nên tách hẳn ra. */
    const airItems  = items.filter(r=>r.transportMode==='AIR');
    const landItems = items.filter(r=>r.transportMode==='LAND');
    const seaItems  = items.filter(r=>r.transportMode!=='AIR' && r.transportMode!=='LAND');

    let html = sectionHtml('🚢 Đường biển (SEA)', 'var(--ice)', seaItems)
             + sectionHtml('✈ Đường hàng không (AIR)', 'var(--amber)', airItems)
             + sectionHtml('🚛 Đường bộ (LAND)', 'var(--safe)', landItems);
    if(!items.length){
      html = `<div class="empty" style="margin-top:18px;">Không có lô nào trong khoảng thời gian đã chọn.</div>`;
    }
    document.getElementById('lib-modal-body').innerHTML = html;
  }

  const modal = document.getElementById('modal-content');
  modal.innerHTML = `
    <button class="modal-close" onclick="document.getElementById('modal-bg').classList.remove('active')">✕</button>
    <h2 style="font-family:var(--font-display);margin:0 0 4px;">${escapeHtml(label)}</h2>
    <div class="hint" style="margin-bottom:14px;">${allItems.length} lô data logger đã lưu cho quốc gia này</div>
    <div class="grid-2">
      <div class="field"><label class="field-label">Từ ngày</label><input type="date" id="lib-filter-from"></div>
      <div class="field"><label class="field-label">Đến ngày</label><input type="date" id="lib-filter-to"></div>
    </div>
    <div id="lib-modal-body"></div>
  `;
  document.getElementById('modal-bg').dataset.panel = '';
  document.getElementById('modal-bg').classList.add('active');
  document.getElementById('lib-filter-from').addEventListener('change', render);
  document.getElementById('lib-filter-to').addEventListener('change', render);
  render();
};
window.removeShipmentFromGroup = async function(id, groupKey){
  if(!isAdmin){ toast('Chỉ tài khoản admin mới xoá được. Bấm "Đăng nhập admin" ở góc trên trước.'); return; }
  if(!confirm('Xoá lô dữ liệu này khỏi kho? Không thể hoàn tác.')) return;
  if(!await requireAdminStepUp()) return;
  if(!await deleteShipment(id)){
    toast('XOÁ KHÔNG THÀNH CÔNG — máy chủ từ chối. Dữ liệu vẫn còn. Mở F12 > Console xem lỗi.');
    renderLibrary();
    return;
  }
  toast('Đã xoá.');
  renderLibrary();
  const idx = await loadIndex();
  const remaining = idx.some(r=>norm(r.dest||'khac')===groupKey);
  if(remaining) openCountryGroup(groupKey);
  else document.getElementById('modal-bg').classList.remove('active');
};

/* Xác thực 2 bước đã được loại bỏ do thiết kế cũ ở client không an toàn. */
async function requireAdminStepUp(){
  if(!HAS_FIREBASE) return true;
  const user = fsAuth && fsAuth.currentUser;
  if(!user || user.email !== ADMIN_EMAIL){
    toast('Chỉ tài khoản admin mới có quyền thực hiện hành động này.');
    return false;
  }
  return true;
}
/* ==========================================================================
   BẢNG TRẠNG THÁI BẢO MẬT
   ========================================================================== */
function _secRow(dot, title, body){
  return '<div class="sec-row"><span class="sec-dot ' + dot + '"></span><div><b>' +
         escapeHtml(title) + '</b><div class="hint" style="margin-top:3px;">' + body + '</div></div></div>';
}
function securityPanelHtml(embedded){
  const ac = appCheckState;
  const acDot  = ac.ok ? 'sec-ok' : (APPCHECK_MODE === 'off' ? 'sec-warn' : 'sec-bad');
  const acHtml = _secRow(acDot, 'App Check (chặn bot dội request)',
    escapeHtml(ac.message) +
    (ac.detail ? '<div style="opacity:.55;font-size:11px;margin-top:5px;">' + escapeHtml(ac.detail) + '</div>' : ''));

  let enforceDot, enforceMsg;
  if(ac.ok){
    enforceDot = 'sec-ok';
    enforceMsg = 'ĐƯỢC. Vào Firebase console > App Check > APIs, bấm Enforce cho Cloud Firestore và Firebase Authentication.';
  }else if(APPCHECK_MODE === 'off'){
    enforceDot = 'sec-warn';
    enforceMsg = 'KHÔNG. App Check đang tắt. Khuyến nghị bật lại.';
  }else{
    enforceDot = 'sec-bad';
    enforceMsg = 'KHÔNG. App Check đang lỗi.';
  }
  const enforceHtml = _secRow(enforceDot, 'Đã bật Enforce trên server chưa?', enforceMsg);

  return (embedded ? '' : '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;"><h2 style="font-family:var(--font-display);margin:0;">Bảo mật hệ thống</h2><button class="modal-close" onclick="document.getElementById(\'modal-bg\').classList.remove(\'active\')">×</button></div>') +
         acHtml + enforceHtml;
}
function updateSecurityPanel(){
  const bg = document.getElementById('modal-bg');
  if(bg && bg.classList.contains('active') && bg.dataset.panel === 'security'){
    document.getElementById('modal-content').innerHTML = securityPanelHtml();
  }
}
function openSecurityPanel(){
  const bg = document.getElementById('modal-bg');
  bg.dataset.panel = 'security';
  document.getElementById('modal-content').innerHTML = securityPanelHtml();
  bg.classList.add('active');
}

  function updateAdminUI(){
    const btn = document.getElementById('admin-login-btn');
    if(!btn) return;
    if(isLoggedIn){
      const email = (fsAuth && fsAuth.currentUser) ? fsAuth.currentUser.email : '';
      const isAdminAccount = email === ADMIN_EMAIL;
      btn.textContent = isAdminAccount ? '🛡️' : '👤';
      btn.title = (isAdminAccount ? 'Admin' : 'Tài khoản') + ': ' + email;
      btn.classList.remove('warn');
      btn.onclick = openAccountPanel;
    }else{
      btn.textContent = '👤';
      btn.title = 'Chưa đăng nhập';
      btn.classList.remove('warn');
      btn.onclick = null;
    }
  }

/* Bảng "Tài khoản": email, đăng xuất, và trạng thái bảo mật gộp chung — thay cho
   hai nút to chiếm chỗ trên thanh đầu trang. */
function openAccountPanel(){
  const bg = document.getElementById('modal-bg');
  bg.dataset.panel = 'account';
  document.getElementById('modal-content').innerHTML = accountPanelHtml();
  bg.classList.add('active');
  const out = document.getElementById('acc-signout');
  if(out) out.onclick = async ()=>{
    bg.classList.remove('active');
    mfaUnlockUntil = 0;
    await fsAuth.signOut();
    toast('Đã đăng xuất.');
  };
}
function accountPanelHtml(){
  const email = (fsAuth && fsAuth.currentUser) ? fsAuth.currentUser.email : '';
  const isAdminAccount = email === ADMIN_EMAIL;
  return '<button class="modal-close" onclick="document.getElementById(\'modal-bg\').classList.remove(\'active\')">×</button>' +
    '<h2 style="font-family:var(--font-display);margin:0 0 4px;">Tài khoản</h2>' +
    '<div class="hint" style="margin-bottom:16px;">' + escapeHtml(email) +
      (isAdminAccount ? ' · <b style="color:var(--accent,#5bd9e8);">Quản trị viên</b>' : ' · Tài khoản thường') + '</div>' +
    '<button class="btn btn-ghost btn-sm" id="acc-signout">Đăng xuất</button>' +
    '<div style="height:20px;"></div>' +
    securityPanelHtml(true);
}
function updateAccountPanel(){
  const bg = document.getElementById('modal-bg');
  if(bg && bg.classList.contains('active') && bg.dataset.panel === 'account'){
    openAccountPanel();
  }
}

function updateGate(){
  const gate = document.getElementById('login-gate');
  const topbar = document.getElementById('app-topbar');
  const wrap = document.getElementById('app-wrap');
  if(!HAS_FIREBASE || isLoggedIn){
    gate.classList.remove('active');
    topbar.style.display = '';
    wrap.style.display = '';
  }else{
    gate.classList.add('active');
    topbar.style.display = 'none';
    wrap.style.display = 'none';
    /* mfa-gate có z-index cao hơn login-gate, nếu không đóng nó sẽ lơ lửng
       đè lên màn hình đăng nhập sau khi đăng xuất giữa chừng. */
    const mfaGate = document.getElementById('mfa-gate');
    if(mfaGate) mfaGate.classList.remove('active');
  }
}

document.getElementById('gate-submit').addEventListener('click', async ()=>{
  const email = document.getElementById('gate-email').value.trim();
  const pass = document.getElementById('gate-pass').value;
  const errEl = document.getElementById('gate-error');
  errEl.style.display = 'none';
  if(!fsAuth){
    errEl.textContent = 'Đang khởi tạo kết nối bảo mật, chờ 1–2 giây rồi bấm lại.';
    errEl.style.display = 'block';
    return;
  }
  try{
    await fsAuth.signInWithEmailAndPassword(email, pass);
  }catch(e){
    console.error('login error', e.code, e.message);
    const FRIENDLY = {
      'auth/wrong-password': 'Sai mật khẩu.',
      'auth/invalid-credential': 'Sai email hoặc mật khẩu.',
      'auth/user-not-found': 'Không tìm thấy tài khoản với email này. Kiểm tra lại đúng chữ (không dấu cách thừa).',
      'auth/invalid-email': 'Email không đúng định dạng.',
      'auth/user-disabled': 'Tài khoản này đã bị vô hiệu hoá (Disable) trong Firebase.',
      'auth/too-many-requests': 'Đăng nhập sai quá nhiều lần, Firebase tạm khoá thử lại sau vài phút.',
      'auth/network-request-failed': 'Lỗi mạng, kiểm tra lại kết nối internet.',
    };
    errEl.textContent = (FRIENDLY[e.code] || (e.code + ': ' + e.message)) + ' [' + (e.code||'no-code') + ']';
    errEl.style.display = 'block';
  }
});
document.getElementById('gate-pass').addEventListener('keydown', e=>{
  if(e.key==='Enter') document.getElementById('gate-submit').click();
});

window.removeShipment = async function(id){
  if(HAS_FIREBASE && !isAdmin){ toast('Chỉ tài khoản admin mới xoá được.'); return; }
  if(!confirm('Xoá lô dữ liệu này khỏi kho? Không thể hoàn tác.')) return;
  if(!await requireAdminStepUp()) return;
  if(!await deleteShipment(id)){
    toast('XOÁ KHÔNG THÀNH CÔNG — máy chủ từ chối. Dữ liệu vẫn còn. Mở F12 > Console xem lỗi.');
  }else{
    toast('Đã xoá.');
  }
  renderLibrary();
};

window.openDetail = async function(id){
  const r = await getShipment(id);
  if(!r){ toast('Không tìm thấy dữ liệu.'); return; }
  const modalBg = document.getElementById('modal-bg');
  const modal = document.getElementById('modal-content');
  const tripDays = ((r.stop-r.start)/86400000).toFixed(1);
  modal.innerHTML = `
    <button class="modal-close" onclick="document.getElementById('modal-bg').classList.remove('active')">✕</button>
    <h2 style="font-family:var(--font-display);margin:0 0 4px;">${escapeHtml(r.origin||'?')} → ${escapeHtml(r.dest||'?')}</h2>
    <div class="hint" style="margin-bottom:16px;">${escapeHtml(r.fileName)} · Device ${escapeHtml(r.deviceId||'N/A')} · ${tripDays} ngày</div>
    <div class="ribbon-wrap"><canvas id="modal-linechart" style="width:100%;height:220px;display:block;"></canvas></div>
    <div class="stat-strip">
      <div class="stat-item"><b>${fmt1(r.max)}°C</b><span>Cao nhất</span></div>
      <div class="stat-item"><b>${fmt1(r.min)}°C</b><span>Thấp nhất</span></div>
      <div class="stat-item"><b>${fmt1(r.avg)}°C</b><span>Trung bình</span></div>
    </div>
    ${r.drug?`<div class="hint">Thuốc / lô hàng: ${escapeHtml(r.drug)}</div>`:''}
    ${(r.reqMin!=null||r.reqMax!=null)?`<div class="hint">Ngưỡng yêu cầu: ${r.reqMin!=null?r.reqMin+'°C':'—'} ~ ${r.reqMax!=null?r.reqMax+'°C':'—'}</div>`:''}
    <div style="display:flex;gap:10px;margin-top:14px;">
      ${r.pdfBase64
        ? `<button class="btn btn-primary btn-sm" id="btn-open-pdf"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg> Mở file PDF gốc</button>`
        : `<span class="hint">(File PDF gốc chưa được lưu — lô này tải lên trước khi có tính năng này)</span>`}
    </div>
  `;
  modalBg.dataset.panel = '';
  modalBg.classList.add('active');
  requestAnimationFrame(()=>drawLoggerLineChart(document.getElementById('modal-linechart'), r.points));
  if(r.pdfBase64){
    const btnPdf = document.getElementById('btn-open-pdf');
    if(btnPdf) btnPdf.addEventListener('click', ()=>openPdfFromBase64(r.pdfBase64, r.fileName));
  }
};
document.getElementById('modal-bg').addEventListener('click', e=>{
  if(e.target.id==='modal-bg') e.currentTarget.classList.remove('active');
});

/* init */
(function(){
  /* Dòng trạng thái đồng bộ đã ẩn khỏi thanh đầu trang cho gọn — vẫn giữ phần
     tử để không phải sửa chỗ khác, chỉ là không hiện ra nữa. */
  if(HAS_FIREBASE){
    updateGate();
  }else{
    document.getElementById('admin-login-btn').style.display = 'none';
  }
  updateAdminUI();
})();
if(!HAS_FIREBASE) renderLibrary();
