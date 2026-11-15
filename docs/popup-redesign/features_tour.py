"""Every click target -> information panel, with real input. Records map drift for each selection.

usage: python features_tour.py <out_dir> <width> <height> <tag> [url]

Mission Planner: water region marker, water cell (long explanation, scrolled), rover track, photo site,
generate a route, route warning, route stop, rapid switching across kinds, and (touch devices) closing the
bottom sheet by dragging its handle down."""
import json, os, sys, time

sys.path.insert(0, os.path.dirname(__file__))
from cdp import Browser

OUT, W, H, TAG = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
URL = sys.argv[5] if len(sys.argv) > 5 else "http://localhost:5193/"
os.makedirs(OUT, exist_ok=True)
b = Browser(W, H, port=9471 + (W % 97))
R = {"tag": TAG, "viewport": [W, H], "steps": {}}

b.goto(URL, 8)
b.js("""const sleep=(t)=>new Promise(r=>setTimeout(r,t));
document.querySelectorAll('.onboarding button, .qg-close, .modal-backdrop button').forEach(x=>{ if(/skip|close|got it|start|let/i.test(x.textContent+(x.getAttribute('aria-label')||''))) x.click(); });
await sleep(400);
const nav=[...document.querySelectorAll('button')].find(x=>/Mission Planner/.test(x.textContent)); nav?.click(); await sleep(1500); return 1""")
b.js("""const m=window.__pawprintMap.map; window.__mv={move:0}; m.on('move',()=>__mv.move++);
window.__st=()=>{const c=m.getCenter(); return {lat:c.lat, lon:c.lng, z:m.getZoom()}};
window.__panel=()=>{const p=document.querySelector('[data-testid=map-info]'); if(!p) return null; const r=p.getBoundingClientRect(); const body=p.querySelector('.mi-body');
 const nested=[...p.querySelectorAll('*')].filter(e=>e!==body && /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight>e.clientHeight+1).length;
 return {selection:p.dataset.selection, layout:p.dataset.layout, title:p.querySelector('h2').textContent, rect:[r.left,r.top,r.width,r.height].map(Math.round),
  inViewport: r.left>=-0.5&&r.top>=-0.5&&r.right<=innerWidth+0.5&&r.bottom<=innerHeight+0.5, bodyScrolls: body? body.scrollHeight>body.clientHeight+1:false,
  nestedScrollAreas:nested, actionsVisible: (()=>{const a=p.querySelector('.mi-actions'); if(!a) return null; const q=a.getBoundingClientRect(); return q.top>=r.top-0.5 && q.bottom<=r.bottom+0.5;})(),
  covered:!!p.querySelector('.mi-covered'), badges:[...p.querySelectorAll('.kind-badge, .badge, [class*=badge]')].map(x=>x.textContent.trim()).filter(Boolean).slice(0,4)}};
return 1""")


def setview(lat, lon, z):
    b.js(f"window.__pawprintMap.map.setView([{lat},{lon}],{z},{{animate:false}}); return 1")
    time.sleep(0.7)


def step(name, action, wait=1.0, shot=True):
    b.js("__mv.move=0; return 1")
    s0 = b.js("return __st()")
    action()
    time.sleep(wait)
    s1 = b.js("return __st()")
    k = 2 ** s0["z"]
    drift = round(((s1["lon"] - s0["lon"]) * k) ** 2 + ((s1["lat"] - s0["lat"]) * k) ** 2) ** 0.5 if s0["z"] == s1["z"] else "zoom changed"
    rec = {"drift_px": drift, "move_events": b.js("return __mv.move"), "panel": b.js("return __panel()")}
    R["steps"][name] = rec
    print(name, json.dumps(rec))
    if shot:
        b.shot(os.path.join(OUT, f"{TAG}_{name}.png"))
    return rec


def close():
    b.js("document.querySelector('[data-testid=map-info] .mi-close')?.click(); return 1")
    time.sleep(0.3)


def center_of(sel):
    return b.js(f"""const e=document.querySelector({json.dumps(sel)}); if(!e) return null; const r=e.getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2]""")


def toggle(label):
    # layer rows only exist while the layers panel and their category are expanded
    ok = b.js(f"""const sleep=(t)=>new Promise(r=>setTimeout(r,t));
const exp=document.querySelector('.layers-panel [aria-label="Expand layers panel"]'); if(exp){{ exp.click(); await sleep(400); }}
for (const c of document.querySelectorAll('.layers-panel [aria-expanded=false]')) {{ c.click(); await sleep(120); }}
const t=document.querySelector('[aria-label={json.dumps(label)}]'); if(t && t.getAttribute('aria-checked')!=='true') t.click(); return !!t""")
    print("toggle", label, ok)
    time.sleep(1.2)


def bring_map_into_view():
    # phones: the map sits below the hero; scroll the page so it is on screen (page scroll, not the map)
    b.js("document.querySelector('.leaflet-container').scrollIntoView({block:'start'}); return 1")
    time.sleep(0.4)


bring_map_into_view()
# ---- Water evidence: region marker, then a cell (long explanation) ----
toggle("Ancient Water Evidence layer")
z = b.js("""const r=await (await fetch('/data/water_evidence.json')).json(); return r.zones[0]""")
setview(z["target"][1], z["target"][0], 14.5)
bring_map_into_view()
pt = b.js(f"""const m=window.__pawprintMap.map; const r=m.getContainer().getBoundingClientRect(); const p=m.latLngToContainerPoint([{z['target'][1]},{z['target'][0]}]); return [r.left+p.x, r.top+p.y]""")
step("water_region", lambda: b.click(pt[0], pt[1]))
close()
step("water_cell", lambda: b.click(pt[0] - 26, pt[1] + 18))
b.js("[...document.querySelectorAll('[data-testid=map-info] .link-btn')].find(x=>/Why this score/.test(x.textContent))?.click(); return 1")
time.sleep(0.4)
rec = step("water_cell_expanded", lambda: None, wait=0.3)
b.js("const body=document.querySelector('[data-testid=map-info] .mi-body'); body.scrollTop=body.scrollHeight; return 1")
time.sleep(0.3)
step("water_cell_scrolled_to_end", lambda: None, wait=0.2)
close()
b.js("""const t=document.querySelector('[aria-label="Ancient Water Evidence layer"]'); if(t && t.getAttribute('aria-checked')==='true') t.click(); return 1""")
time.sleep(0.6)

# ---- Rover track ----
toggle("Rover tracks layer")
setview(18.4447, 77.4508, 15.5)
bring_map_into_view()
rp = b.js("""const m=window.__pawprintMap.map; const cr=m.getContainer().getBoundingClientRect();
const paths=[...document.querySelectorAll('.leaflet-rover-pane path')];
for (const p of paths){ const L0=p.getTotalLength(); if(L0<60) continue; const q=p.getPointAtLength(L0/2); const ctm=p.getScreenCTM(); const x=ctm.a*q.x+ctm.c*q.y+ctm.e, y=ctm.b*q.x+ctm.d*q.y+ctm.f;
 if(x>cr.left+40 && x<cr.left+cr.width*0.55 && y>cr.top+90 && y<cr.bottom-90 && y>0 && y<innerHeight-200) return [x,y]; } return null""")
if rp:
    step("rover_track", lambda: b.click(rp[0], rp[1]))
    close()
else:
    print("rover_track: no clickable track segment in view")

# ---- Photo site ----
toggle("Ground View photos layer")
time.sleep(0.8)
cp = b.js("""const cr=document.querySelector('.leaflet-container').getBoundingClientRect(); for (const e of document.querySelectorAll('.cam-pin')){ const r=e.getBoundingClientRect(); const x=r.left+r.width/2,y=r.top+r.height/2;
 if(x>cr.left+30&&x<cr.left+cr.width*0.6&&y>cr.top+80&&y<cr.bottom-80&&y<innerHeight-200) return [x,y]; } return null""")
if cp:
    step("photo_site", lambda: b.click(cp[0], cp[1]))
    close()

# ---- Destination via the clicked-spot panel, then generate a route ----
b.js("""for (const l of ['Ground View photos layer','Rover tracks layer']) { const t=document.querySelector(`[aria-label="${l}"]`); if(t && t.getAttribute('aria-checked')==='true') t.click(); } return 1""")
time.sleep(0.5)
setview(18.4447, 77.4508, 15)
bring_map_into_view()
mr = b.js("const r=document.querySelector('.leaflet-container').getBoundingClientRect(); return [r.left,r.top,r.width,r.height]")
# an open spot on screen, up-left of the landing site (works on every map size)
dest = b.js("""const m=window.__pawprintMap.map; const r=m.getContainer().getBoundingClientRect(); const p=m.latLngToContainerPoint([18.4447, 77.4508]);
return [r.left+Math.max(40, p.x-Math.min(160, r.width*0.3)), Math.max(r.top+120, r.top+p.y-Math.min(130, r.height*0.25))]""")
step("pick_spot", lambda: b.click(dest[0], dest[1]))
b.js("[...document.querySelectorAll('[data-testid=map-info] .mi-btn')].find(x=>/Set Destination/.test(x.textContent))?.click(); return 1")
time.sleep(0.8)
R["destination_set"] = b.js("return !document.querySelector('[data-testid=map-info]') && [...document.querySelectorAll('.stop-label')].some(x=>/Science Site/.test(x.textContent))")
print("destination_set", R["destination_set"])
b.js("document.querySelector('.pp-generate-btn')?.click(); return 1")
for _ in range(40):
    time.sleep(1)
    if b.js("return !!(window.__pawprintHazards && window.__pawprintHazards.list().length) || !!document.querySelector('.leaflet-route-pane path')"):
        break
time.sleep(2.5)  # route framing (flyToBounds on a NEW route result, not on selection)
R["hazards"] = b.js("return window.__pawprintHazards ? window.__pawprintHazards.list().length : 0")
print("hazards", R["hazards"])
bring_map_into_view()
hz = center_of(".hz-ico")
if hz:
    step("route_warning", lambda: b.click(hz[0], hz[1]))
    close()
stp = b.js("""const cr=document.querySelector('.leaflet-container').getBoundingClientRect(); for (const e of document.querySelectorAll('.stop-pin')){ const r=e.getBoundingClientRect(); if(r.top>cr.top && r.bottom<cr.bottom && r.bottom<innerHeight-120) return [r.left+r.width/2, r.top+r.height*0.35]; } return null""")
if stp:
    step("route_stop", lambda: b.click(stp[0], stp[1]))

# ---- Rapid switching across kinds (sample, stop, warning, sample...) ----
# keep every target on open map: left of where the side panel and the zoom column can be (or above the sheet)
targets = b.js("""const cr=document.querySelector('.leaflet-container').getBoundingClientRect(); const out=[];
const pw=parseFloat(getComputedStyle(document.querySelector('.map-wrap')).getPropertyValue('--mi-w'))||380; const side=document.querySelector('[data-testid=map-info]')?.dataset.layout!=='sheet';
const p= side ? {left: cr.right-pw-90, top: cr.top-999, bottom: cr.bottom+999} : {left: -1, top: innerHeight*0.45, bottom: innerHeight+999};
for (const s of ['.poi-marker','.stop-pin','.hz-ico','.poi-cluster']) for (const e of document.querySelectorAll(s)) { const r=e.getBoundingClientRect(); const x=r.left+r.width/2, y=r.top+r.height/2;
 if (x>cr.left+20 && x<cr.right-20 && y>cr.top+60 && y<cr.bottom-40 && y<innerHeight-120 && !(x>p.left && y>p.top && y<p.bottom)) { out.push([x,y,s]); break; } } return out""")


def rapid():
    for _ in range(3):
        for (x, y, _s) in targets:
            b.click(x, y)
            time.sleep(0.09)


rec = step("rapid_switch_kinds", rapid, wait=1.2)
rec["targets"] = [t[2] for t in targets]

# ---- Touch: drag the sheet's handle down to close ----
if b.touch:
    b.js("await window.__pawprintMap.openPoi('landing'); return 1")
    time.sleep(0.5)
    h = center_of("[data-testid=map-info] .mi-handle")
    b.shot(os.path.join(OUT, f"{TAG}_sheet_before_drag.png"))
    if h:
        b.drag_touch(h[0], h[1], h[1] + 180)
        time.sleep(0.6)
    R["sheet_drag_closes"] = not b.js("return !!document.querySelector('[data-testid=map-info]')")
    print("sheet_drag_closes", R["sheet_drag_closes"])

R["console_errors"] = b.errors()
print("errors", R["console_errors"])
json.dump(R, open(os.path.join(OUT, f"{TAG}_tour.json"), "w"), indent=2)
b.close()
