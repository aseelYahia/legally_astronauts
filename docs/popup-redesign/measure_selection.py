"""Measures map movement and detail-surface placement when things on the map are selected.

usage: python measure_selection.py <out_dir> <width> <height> <tag> [url]

Works on both the old Leaflet popups (.leaflet-popup) and the new information panel
([data-testid=map-info]); it reports whichever is on screen. All clicks are real CDP input events.

Scenarios (Mission Planner):
  edges   click empty ground near the left / right / top / bottom map edges
  sample  click a NASA sample marker that sits near the right map edge
  rapid   click four different sample markers 120 ms apart
  long    open the longest science description, check it scrolls inside the surface
For each: map centre drift (px at the current zoom), Leaflet 'move' events, and whether the
surface is fully inside the viewport."""
import json, os, sys, time

sys.path.insert(0, os.path.dirname(__file__))
from cdp import Browser

OUT, W, H, TAG = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
URL = sys.argv[5] if len(sys.argv) > 5 else "http://localhost:5193/"
os.makedirs(OUT, exist_ok=True)
b = Browser(W, H, port=9371 + (W % 97))
results = {"tag": TAG, "viewport": [W, H], "scenarios": {}}

b.goto(URL, 8)
b.js("""const sleep=(t)=>new Promise(r=>setTimeout(r,t));
document.querySelectorAll('.onboarding button, .qg-close, .modal-backdrop button').forEach(x=>{ if(/skip|close|got it|start|let/i.test(x.textContent+(x.getAttribute('aria-label')||''))) x.click(); });
await sleep(400);
const nav=[...document.querySelectorAll('button')].find(x=>/Mission Planner/.test(x.textContent)); nav?.click(); await sleep(1500);
return !!nav;""")

INSTALL = """
const m=window.__pawprintMap.map; window.__mv={move:0, flies:0};
if(!m.__counted){ m.on('move',()=>__mv.move++); const f=m.flyTo; m.flyTo=function(...a){__mv.flies++; return f.apply(this,a)}; const pt=m.panTo; m.panTo=function(...a){__mv.flies++; return pt.apply(this,a)}; const sv=m.setView; m.__counted=true; }
window.__state=()=>{ const c=m.getCenter(); return {lat:c.lat, lon:c.lng, z:m.getZoom()}; };
window.__surface=()=>{
  const panel=document.querySelector('[data-testid=map-info]');
  const pop=document.querySelector('.leaflet-popup');
  const el=panel||pop; if(!el) return null;
  const r=el.getBoundingClientRect();
  const sc=panel ? panel.querySelector('.mi-body') : pop.querySelector('.leaflet-popup-content');
  const inside = r.left>=-0.5 && r.top>=-0.5 && r.right<=innerWidth+0.5 && r.bottom<=innerHeight+0.5;
  const mr=document.querySelector('.leaflet-container').getBoundingClientRect();
  const insideMap = r.left>=mr.left-0.5 && r.top>=mr.top-0.5 && r.right<=mr.right+0.5 && r.bottom<=mr.bottom+0.5;
  const nested=[...el.querySelectorAll('*')].filter(e=>{const s=getComputedStyle(e); return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight>e.clientHeight+1;}).length;
  const cov=!!(panel && panel.querySelector('.mi-covered'));
  return {kind: panel?'panel':'popup', covered_hint:cov, layout: panel? panel.dataset.layout : null, rect:[r.left,r.top,r.width,r.height].map(Math.round), inViewport:inside, inMap:insideMap,
          scrolls: sc? sc.scrollHeight>sc.clientHeight+1 : false, scrollAreas:nested, title:(el.querySelector('h2,.popup-title,b')||{}).textContent?.trim().slice(0,60)};
};
return 1;"""
b.js(INSTALL)


def drift(s0, s1):
    k = 2 ** s0["z"]
    return round(((s1["lon"] - s0["lon"]) * k) ** 2 + ((s1["lat"] - s0["lat"]) * k) ** 2) ** 0.5 if s0["z"] == s1["z"] else "zoom changed"


def measure(name, action, wait=1.3):
    b.js("__mv.move=0; __mv.flies=0; return 1")
    s0 = b.js("return __state()")
    action()
    time.sleep(wait)
    s1 = b.js("return __state()")
    rec = {"drift_px": drift(s0, s1), "move_events": b.js("return __mv.move"), "fly_calls": b.js("return __mv.flies"), "surface": b.js("return __surface()")}
    b.shot(os.path.join(OUT, f"{TAG}_{name}.png"))
    results["scenarios"][name] = rec
    print(name, json.dumps(rec))
    return rec


def close_surface():
    b.js("""const x=document.querySelector('[data-testid=map-info] .mi-close')||document.querySelector('.leaflet-popup-close-button'); x?.click(); return 1""")
    time.sleep(0.4)


mr = b.js("const r=document.querySelector('.leaflet-container').getBoundingClientRect(); return [r.left,r.top,r.width,r.height]")
mx, my, mw, mh = mr
# Start from the same framing in both runs (no animation)
b.js("""const m=window.__pawprintMap.map; m.setView([18.4447, 77.4508], 14.5, {animate:false}); return 1""")
time.sleep(0.8)

# Empty ground near each edge: avoid the zoom column on the right and the panels at the top
edges = {
    "edge_left": (mx + 24, my + mh * 0.55),
    "edge_right": (mx + mw - 70, my + mh * 0.72),
    "edge_top": (mx + mw * 0.45, my + 70),
    "edge_bottom": (mx + mw * 0.4, my + mh - 40),
}
for name, (x, y) in edges.items():
    close_surface()  # with the panel open, a click on its area hits the panel, not the map
    measure(name, lambda x=x, y=y: b.click(x, y))

close_surface()
# A sample marker near the right map edge
pos = b.js("""const m=window.__pawprintMap.map; const ids=window.__pawprintMap.groups().filter(g=>g.members.length===1).map(g=>g.members[0]);
const want=ids[0]; return want""")
b.js(f"""const m=window.__pawprintMap.map; const p=(await (await fetch('/data/pois.json')).json());
const list=Array.isArray(p)?p:(p.pois||p.features||[]); const q=list.find(x=>x.id==={json.dumps(pos)});
window.__q=q; const z=15.5; const c=m.getSize(); const target=L.point(c.x-110, c.y*0.5);
const proj=m.project([q.lat,q.lon], z); const centre=m.unproject(proj.subtract(target).add(c.divideBy(2)), z);
m.setView(centre, z, {{animate:false}}); return q.name""")
time.sleep(0.9)
b.js(INSTALL)
pt = b.js("""const m=window.__pawprintMap.map; const r=m.getContainer().getBoundingClientRect(); const p=m.latLngToContainerPoint([__q.lat,__q.lon]); return [r.left+p.x, r.top+p.y]""")
measure("sample_right_edge", lambda: b.click(pt[0], pt[1]))

# Rapid switching between four markers
close_surface()
b.js("""const m=window.__pawprintMap.map; m.setView([18.4447, 77.4508], 14.5, {animate:false}); return 1""")
time.sleep(0.8)
pts = b.js("""const m=window.__pawprintMap.map; const r=m.getContainer().getBoundingClientRect(); const s=m.getSize();
const out=[]; for (const el of document.querySelectorAll('.poi-marker')) { const q=el.getBoundingClientRect(); const x=q.left+q.width/2, y=q.top+q.height/2;
 if (x>r.left+60 && x<r.left+s.x*0.6 && y>r.top+80 && y<r.bottom-80) out.push([x,y]); } return out.slice(0,4)""")


def rapid():
    for (x, y) in pts:
        b.click(x, y)
        time.sleep(0.12)


measure("rapid_switch", rapid, wait=1.5)
results["scenarios"]["rapid_switch"]["markers_clicked"] = len(pts)

# Long scientific description: the landing site / longest description
close_surface()
b.js("""const m=window.__pawprintMap.map; m.setView([18.4447, 77.4508], 14.5, {animate:false}); return 1""")
time.sleep(0.6)
longest = b.js("""const p=(await (await fetch('/data/pois.json')).json()); const list=Array.isArray(p)?p:(p.pois||[]);
return list.filter(x=>x.description).sort((a,b)=>b.description.length-a.description.length)[0]?.id""")
b.js(INSTALL)
measure("long_description", lambda: b.js(f"await window.__pawprintMap.openPoi({json.dumps(longest)}); return 1"))

# Escape closes; close button closes
if b.js("return !!document.querySelector('[data-testid=map-info]')"):
    b.key("Escape", "Escape", 27)
    time.sleep(0.4)
    results["escape_closes"] = not b.js("return !!document.querySelector('[data-testid=map-info]')")
    print("escape_closes", results["escape_closes"])

results["console_errors"] = b.errors()
json.dump(results, open(os.path.join(OUT, f"{TAG}_results.json"), "w"), indent=2)
print("errors", results["console_errors"])
b.close()
