"""Headless Edge screenshots of the running app via the DevTools protocol (stdlib-only websocket client)."""
import re
import base64, json, os, socket, struct, subprocess, sys, tempfile, time, urllib.request

OUT = sys.argv[1]; W=int(sys.argv[2]); H=int(sys.argv[3]); MOBILE=W<768
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PORT = 9361
prof = tempfile.mkdtemp(prefix="edgecdp")
proc = subprocess.Popen([EDGE, "--headless=new", f"--remote-debugging-port={PORT}", f"--user-data-dir={prof}", f"--window-size={W},{H}",
                         "--hide-scrollbars", "--force-device-scale-factor=1", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(50):
    try:
        tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json"))
        page = next(t for t in tabs if t["type"] == "page")
        break
    except Exception:
        time.sleep(0.3)
ws_url = page["webSocketDebuggerUrl"]
host_port, path = ws_url[len("ws://"):].split("/", 1)
h, p = host_port.split(":")
s = socket.create_connection((h, int(p)))
key = base64.b64encode(os.urandom(16)).decode()
s.send(f"GET /{path} HTTP/1.1\r\nHost: {host_port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n".encode())
buf = b""
while b"\r\n\r\n" not in buf:
    buf += s.recv(4096)
rest = buf.split(b"\r\n\r\n", 1)[1]


def recv_exact(n):
    global rest
    while len(rest) < n:
        rest += s.recv(1 << 20)
    d, rest = rest[:n], rest[n:]
    return d


def recv_msg():
    data = b""
    while True:
        b1, b2 = recv_exact(2)
        ln = b2 & 0x7F
        if ln == 126:
            ln = struct.unpack(">H", recv_exact(2))[0]
        elif ln == 127:
            ln = struct.unpack(">Q", recv_exact(8))[0]
        data += recv_exact(ln)
        if b1 & 0x80:
            return json.loads(data)


mid = 0


EVENTS = []
def send(method, **params):
    global mid
    mid += 1
    payload = json.dumps({"id": mid, "method": method, "params": params}).encode()
    hdr = bytes([0x81])
    n = len(payload)
    hdr += bytes([0x80 | n]) if n < 126 else (bytes([0x80 | 126]) + struct.pack(">H", n) if n < 65536 else bytes([0x80 | 127]) + struct.pack(">Q", n))
    mask = os.urandom(4)
    s.send(hdr + mask + bytes(c ^ mask[i % 4] for i, c in enumerate(payload)))
    while True:
        m = recv_msg()
        if m.get("method") in ("Runtime.exceptionThrown", "Log.entryAdded", "Runtime.consoleAPICalled"):
            EVENTS.append(m)
        if m.get("id") == mid:
            if "error" in m:
                raise RuntimeError(m["error"])
            return m.get("result", {})


def js(code):
    r = send("Runtime.evaluate", expression=f"(async()=>{{{code}}})()", awaitPromise=True, returnByValue=True)
    return r.get("result", {}).get("value")


def shot(name):
    d = send("Page.captureScreenshot", format="png")["data"]
    open(os.path.join(OUT, name), "wb").write(base64.b64decode(d))
    print("saved", name)

def mouse(x, y, typ="mouseMoved", button="none", clicks=0):
    send("Input.dispatchMouseEvent", type=typ, x=x, y=y, button=button, clickCount=clicks)

send("Emulation.setDeviceMetricsOverride", width=W, height=H, deviceScaleFactor=1, mobile=MOBILE)
send("Page.enable"); send("Runtime.enable"); send("Log.enable")
send("Page.navigate", url="http://localhost:5173/")
time.sleep(7)
TAG = sys.argv[4]
print(js("""const sleep=(t)=>new Promise(r=>setTimeout(r,t));
document.querySelectorAll('.onboarding button, .qg-close').forEach(b=>{ if(/skip|close|got it|start/i.test(b.textContent+b.getAttribute('aria-label'))) b.click(); });
const nav=[...document.querySelectorAll('.nav button, nav button, button')].find(b=>/Mission Planner/.test(b.textContent)); nav?.click(); await sleep(1200);
return 'nav ok '+!!nav;"""))
print(js("""const sleep=(t)=>new Promise(r=>setTimeout(r,t));
const m=window.__pawprintMap.map; m.setView([18.4447, 77.4508], 15, {animate:false}); await sleep(600);
const id = await window.__pawprintMap.openPoi('Melyn'); await sleep(900);
const P = Object.getPrototypeOf(m._popup);
window.__c={update:0, adjustPan:0, layout:0, move:0, moveend:0, open:0, close:0, rects:[], panBy:0};
const wrap=(n,k)=>{ const o=P[n]; if(o.__w) return; const f=function(...a){ window.__c[k]++; return o.apply(this,a); }; f.__w=true; P[n]=f; };
wrap('update','update'); wrap('_adjustPan','adjustPan'); wrap('_updateLayout','layout');
const pb=m.panBy; m.panBy=function(...a){ window.__c.panBy++; return pb.apply(this,a); };
m.on('move',()=>__c.move++); m.on('moveend',()=>__c.moveend++); m.on('popupopen',()=>__c.open++); m.on('popupclose',()=>__c.close++);
const el=document.querySelector('.leaflet-popup');
window.__samp=()=>{ const e=document.querySelector('.leaflet-popup'); if(!e){__c.rects.push(null); return;} const r=e.getBoundingClientRect(); __c.rects.push([Math.round(r.left*10)/10,Math.round(r.top*10)/10,Math.round(r.width),Math.round(r.height)]); };
window.__mo=0; new MutationObserver((l)=>{window.__mo+=l.length}).observe(document.querySelector('.leaflet-popup-pane'),{attributes:true,childList:true,subtree:true});
const r=el.getBoundingClientRect(); const btns=[...el.querySelectorAll('button')].map(b=>{const q=b.getBoundingClientRect(); return {t:b.textContent.trim(), x:q.left+q.width/2, y:q.top+q.height/2};});
return JSON.stringify({id, rect:[r.left,r.top,r.width,r.height], btns});"""))
info = json.loads(js("""const el=document.querySelector('.leaflet-popup'); const r=el.getBoundingClientRect(); const btns=[...el.querySelectorAll('button')].map(b=>{const q=b.getBoundingClientRect(); return {t:b.textContent.trim(), x:q.left+q.width/2, y:q.top+q.height/2};}); return JSON.stringify({rect:[r.left,r.top,r.width,r.height], btns});"""))
shot(f"{TAG}_popup_open.png")
print("LAYOUT", js("""const p=document.querySelector('.leaflet-popup'); const r=p.getBoundingClientRect(); const c=p.querySelector('.leaflet-popup-content');
const hits=[...document.querySelectorAll('.map-buttons, .map-panel, .mp-tray, .map-title, .legend')].filter(e=>{const q=e.getBoundingClientRect(); return q.width>0 && q.left<r.right && r.left<q.right && q.top<r.bottom && r.top<q.bottom;}).map(e=>e.className.slice(0,40));
const mr=document.querySelector('.leaflet-container').getBoundingClientRect();
return JSON.stringify({popup:[r.left,r.top,r.width,r.height].map(Math.round), map:[mr.left,mr.top,mr.width,mr.height].map(Math.round), scrolls: c.scrollHeight>c.clientHeight+1, overlapsControls:hits});"""))
x0, y0, w, h = info["rect"]
# hover: sweep the mouse across the popup body for ~3 s (90 moves), sampling the popup rect each move
js("__c.update=0;__c.adjustPan=0;__c.layout=0;__c.move=0;__c.moveend=0;__c.panBy=0;__c.rects=[];__mo=0; return 1")
t0 = time.time()
for i in range(90):
    fx = 0.15 + 0.7 * ((i % 30) / 29)
    fy = 0.2 + 0.6 * ((i // 30) / 2)
    mouse(x0 + w * fx, y0 + h * fy)
    js("__samp(); return 1")
    time.sleep(0.03)
dt = time.time() - t0
res = json.loads(js("const r=__c.rects.filter(Boolean); const xs=r.map(a=>a[0]), ys=r.map(a=>a[1]); return JSON.stringify({update:__c.update, adjustPan:__c.adjustPan, updateLayout:__c.layout, mapMove:__c.move, moveend:__c.moveend, panBy:__c.panBy, popupopen:__c.open, popupclose:__c.close, mutations:__mo, samples:__c.rects.length, missing:__c.rects.filter(x=>!x).length, distinctRects:new Set(__c.rects.map(String)).size, xRange:Math.max(...xs)-Math.min(...xs), yRange:Math.max(...ys)-Math.min(...ys)});"))
res["hover_seconds"] = round(dt, 2); res["mouse_moves"] = 90
print("HOVER", json.dumps(res))
shot(f"{TAG}_popup_hovered.png")

# EDGE scenario: drag the popup partly out of view (as a user scrolling the map would), then hover it
js("""const sleep=(t)=>new Promise(r=>setTimeout(r,t)); const m=window.__pawprintMap.map; if(!document.querySelector('.leaflet-popup')) await window.__pawprintMap.openPoi('Melyn'); await sleep(400);
const r=document.querySelector('.leaflet-popup').getBoundingClientRect(); const mr=m.getContainer().getBoundingClientRect(); m.panBy([0, Math.round(r.top-mr.top-20)], {animate:false}); await sleep(400);
__c.update=0;__c.adjustPan=0;__c.layout=0;__c.move=0;__c.moveend=0;__c.panBy=0;__c.rects=[];__mo=0; return 1""")
r0 = json.loads(js("const r=document.querySelector('.leaflet-popup').getBoundingClientRect(); return JSON.stringify([r.left,r.top,r.width,r.height])"))
shot(f"{TAG}_edge_before_hover.png")
for i in range(60):
    fx = 0.2 + 0.6 * ((i % 20) / 19)
    rr = json.loads(js("const r=document.querySelector('.leaflet-popup')?.getBoundingClientRect(); return JSON.stringify(r?[r.left,r.top,r.width,r.height]:[0,0,0,0])"))
    mouse(r0[0] + r0[2] * fx, r0[1] + 60 + (i % 3) * 8)   # pointer stays at one screen band, like a hand resting on the popup
    js("__samp(); return 1")
    time.sleep(0.02)
res = json.loads(js("const r=__c.rects.filter(Boolean); const xs=r.map(a=>a[0]), ys=r.map(a=>a[1]); return JSON.stringify({update:__c.update, adjustPan:__c.adjustPan, mapMove:__c.move, moveend:__c.moveend, panBy:__c.panBy, popupclose:__c.close, mutations:__mo, samples:__c.rects.length, distinctRects:new Set(__c.rects.map(String)).size, yRange:Math.max(...ys)-Math.min(...ys)});"))
print("EDGE", json.dumps(res))
shot(f"{TAG}_edge_after_hover.png")

# click test: real click on each action button (re-open popup between clicks)
clicks = []
for b in info["btns"]:
    if not re.search(r"start|waypoint|destination|Ground View", b["t"]): continue
    js("""const sleep=(t)=>new Promise(r=>setTimeout(r,t)); if(!document.querySelector('.leaflet-popup')) await window.__pawprintMap.openPoi('Melyn'); await sleep(500); return 1""")
    js(f"""const el=document.querySelector('.leaflet-popup'); const b=[...el.querySelectorAll('button')].find(x=>x.textContent.trim()==={json.dumps(b['t'])}); b?.scrollIntoView({{block:'nearest'}}); await new Promise(r=>setTimeout(r,200)); return 1""")
    cur = json.loads(js("""const el=document.querySelector('.leaflet-popup'); return JSON.stringify([...el.querySelectorAll('button')].map(b=>{const q=b.getBoundingClientRect(); return {t:b.textContent.trim(), x:q.left+q.width/2, y:q.top+q.height/2};}));"""))
    bb = next((c for c in cur if c["t"] == b["t"]), None)
    if not bb: clicks.append({b["t"]: "missing"}); continue
    # approach like a human: a few moves towards the button, then press
    for k in range(8):
        mouse(bb["x"] - 40 + 5 * k, bb["y"] + 20 - 2.5 * k); time.sleep(0.03)
    hit = js(f"const e=document.elementFromPoint({bb['x']},{bb['y']}); return (e?.closest('button')?.textContent||e?.className||'none').trim()")
    mouse(bb["x"], bb["y"], "mousePressed", "left", 1); mouse(bb["x"], bb["y"], "mouseReleased", "left", 1)
    time.sleep(0.6)
    after = js("return JSON.stringify({popupOpen: !!document.querySelector('.leaflet-popup'), gv: !!document.querySelector('.gv')})")
    clicks.append({"button": b["t"], "underPointer": hit, "after": json.loads(after)})
    js("""const sleep=(t)=>new Promise(r=>setTimeout(r,t)); for(let i=0;i<2;i++){ document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await sleep(200);} document.querySelector('.gv-close, .gv [aria-label*=lose i]')?.click(); await sleep(300); return 1""")
print("CLICKS", json.dumps(clicks))
errs = []
for m in EVENTS:
    if m["method"] == "Runtime.exceptionThrown":
        d = m["params"]["exceptionDetails"]; errs.append("EXCEPTION " + (d.get("exception", {}).get("description") or d.get("text", ""))[:200])
    elif m["method"] == "Runtime.consoleAPICalled" and m["params"]["type"] in ("error", "assert"):
        errs.append("console.error " + " ".join(str(a.get("value", a.get("description", "")))[:160] for a in m["params"]["args"]))
print("ERRORS", len(errs)); [print("  ", e) for e in errs[:10]]
proc.terminate()
