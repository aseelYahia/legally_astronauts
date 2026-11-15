"""Minimal headless-Edge driver over the Chrome DevTools Protocol (stdlib only, no websocket package).

Used by measure_selection.py. Real input goes through Input.dispatchMouseEvent / dispatchTouchEvent /
dispatchKeyEvent, so Leaflet sees the same events a person would produce."""
import base64, json, os, socket, struct, subprocess, tempfile, time, urllib.request

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"


class Browser:
    def __init__(self, w, h, port=9371, mobile=None, touch=None):
        self.w, self.h = w, h
        self.mobile = (w < 768) if mobile is None else mobile
        self.touch = self.mobile if touch is None else touch
        prof = tempfile.mkdtemp(prefix="edgecdp")
        self.proc = subprocess.Popen(
            [EDGE, "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={prof}", f"--window-size={w},{h}",
             "--hide-scrollbars", "--force-device-scale-factor=1", "about:blank"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        page = None
        for _ in range(60):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json"))
                page = next(t for t in tabs if t["type"] == "page")
                break
            except Exception:
                time.sleep(0.3)
        ws = page["webSocketDebuggerUrl"]
        hp, path = ws[len("ws://"):].split("/", 1)
        host, p = hp.split(":")
        self.s = socket.create_connection((host, int(p)))
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.send(f"GET /{path} HTTP/1.1\r\nHost: {hp}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n".encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.s.recv(4096)
        self.rest = buf.split(b"\r\n\r\n", 1)[1]
        self.mid = 0
        self.events = []
        self.send("Emulation.setDeviceMetricsOverride", width=w, height=h, deviceScaleFactor=1, mobile=self.mobile)
        if self.touch:
            self.send("Emulation.setTouchEmulationEnabled", enabled=True, maxTouchPoints=5)
        self.send("Page.enable"); self.send("Runtime.enable"); self.send("Log.enable")

    def _exact(self, n):
        while len(self.rest) < n:
            self.rest += self.s.recv(1 << 20)
        d, self.rest = self.rest[:n], self.rest[n:]
        return d

    def _msg(self):
        data = b""
        while True:
            b1, b2 = self._exact(2)
            ln = b2 & 0x7F
            if ln == 126:
                ln = struct.unpack(">H", self._exact(2))[0]
            elif ln == 127:
                ln = struct.unpack(">Q", self._exact(8))[0]
            data += self._exact(ln)
            if b1 & 0x80:
                return json.loads(data)

    def send(self, method, **params):
        self.mid += 1
        payload = json.dumps({"id": self.mid, "method": method, "params": params}).encode()
        n = len(payload)
        hdr = bytes([0x81]) + (bytes([0x80 | n]) if n < 126 else (bytes([0x80 | 126]) + struct.pack(">H", n) if n < 65536 else bytes([0x80 | 127]) + struct.pack(">Q", n)))
        mask = os.urandom(4)
        self.s.send(hdr + mask + bytes(c ^ mask[i % 4] for i, c in enumerate(payload)))
        while True:
            m = self._msg()
            if m.get("method") in ("Runtime.exceptionThrown", "Log.entryAdded", "Runtime.consoleAPICalled"):
                self.events.append(m)
            if m.get("id") == self.mid:
                if "error" in m:
                    raise RuntimeError(m["error"])
                return m.get("result", {})

    def js(self, code):
        r = self.send("Runtime.evaluate", expression=f"(async()=>{{{code}}})()", awaitPromise=True, returnByValue=True)
        if "exceptionDetails" in r:
            raise RuntimeError(json.dumps(r["exceptionDetails"])[:600])
        return r.get("result", {}).get("value")

    def shot(self, path):
        d = self.send("Page.captureScreenshot", format="png")["data"]
        open(path, "wb").write(base64.b64decode(d))

    def goto(self, url, wait=7):
        self.send("Page.navigate", url=url)
        time.sleep(wait)

    def move(self, x, y):
        self.send("Input.dispatchMouseEvent", type="mouseMoved", x=x, y=y, button="none")

    def click(self, x, y):
        """A real click: mouse for desktop, a tap for touch devices."""
        if self.touch:
            pt = [{"x": x, "y": y, "radiusX": 4, "radiusY": 4, "force": 1, "id": 1}]
            self.send("Input.dispatchTouchEvent", type="touchStart", touchPoints=pt)
            self.send("Input.dispatchTouchEvent", type="touchEnd", touchPoints=[])
            return
        self.move(x, y)
        self.send("Input.dispatchMouseEvent", type="mousePressed", x=x, y=y, button="left", clickCount=1)
        self.send("Input.dispatchMouseEvent", type="mouseReleased", x=x, y=y, button="left", clickCount=1)

    def drag_touch(self, x, y0, y1, steps=8):
        self.send("Input.dispatchTouchEvent", type="touchStart", touchPoints=[{"x": x, "y": y0, "id": 1}])
        for i in range(1, steps + 1):
            self.send("Input.dispatchTouchEvent", type="touchMove", touchPoints=[{"x": x, "y": y0 + (y1 - y0) * i / steps, "id": 1}])
            time.sleep(0.016)
        self.send("Input.dispatchTouchEvent", type="touchEnd", touchPoints=[])

    def key(self, k, code=None, vk=None):
        self.send("Input.dispatchKeyEvent", type="keyDown", key=k, code=code or k, windowsVirtualKeyCode=vk or 0)
        self.send("Input.dispatchKeyEvent", type="keyUp", key=k, code=code or k, windowsVirtualKeyCode=vk or 0)

    def errors(self):
        out = []
        for e in self.events:
            if e["method"] == "Runtime.exceptionThrown":
                out.append(e["params"]["exceptionDetails"].get("exception", {}).get("description", "exception")[:300])
            elif e["method"] == "Log.entryAdded" and e["params"]["entry"]["level"] == "error":
                out.append(e["params"]["entry"]["text"][:300])
            elif e["method"] == "Runtime.consoleAPICalled" and e["params"]["type"] == "error":
                out.append(" ".join(str(a.get("value", a.get("description", "")))[:200] for a in e["params"]["args"]))
        return out

    def close(self):
        try:
            self.proc.kill()
        except Exception:
            pass
