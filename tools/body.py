#!/usr/bin/env python3
"""Fishbowl 身体（沙箱侧）

设计要点（对应 PLAN P1 / SPEC-06）：
- 与 Chrome 的 CDP 走 --remote-debugging-pipe（fd 3/4），**不监听任何端口**
- 与宿主是一条出站 TCP 长连接（NDJSON），连接本身即存活信号
- Chrome 退出用 waitpid 感知（SIGCHLD），不轮询端口
- 页面心跳（Runtime.addBinding）判断"卡住"；silence 超时才重启
- systemd Type=notify + WatchdogSec：判活定时器归 OS，脚本只报"我还在干活"
"""
import json
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.parse

HOME = os.path.expanduser("~")
BIN = os.path.join(HOME, "opt/chrome/chrome-headless-shell-linux64/chrome-headless-shell")
DEPS = os.path.join(HOME, "opt/deps/usr/lib/x86_64-linux-gnu")
LOG = os.path.join(HOME, "fishbowl/body.log")

HOST = os.environ.get("FB_HOST", "127.0.0.1")
PORT = int(os.environ.get("FB_PORT", "9224"))
START_URL = os.environ.get("FB_START_URL", "").strip()


def collect_caps():
    """自报沙箱能力（不是承诺，是实测事实）。桥会按清单校验。"""
    caps = {
        "runtime": "unknown",
        "filesystem": {},
        "network": {},
        "input": {"host_input": False},   # 结构性事实：Linux 侧没有 Win32 输入通道
        "output": {"state_channel": "outbound"},
        "uid": os.getuid() if hasattr(os, "getuid") else None,
    }
    try:
        with open("/proc/version", encoding="utf-8", errors="ignore") as fh:
            caps["runtime"] = "wsl" if "microsoft" in fh.read().lower() else "linux"
    except OSError:
        pass
    caps["filesystem"]["host_fs_visible"] = os.path.exists("/mnt/c/Windows/System32")
    creds = [k for k in os.environ if k.upper().endswith(("_KEY", "_TOKEN", "COOKIE"))]
    caps["filesystem"]["credentials_in_env"] = len(creds) > 0
    try:
        # 只数"本进程自己"的监听 socket（不是整个网络命名空间的）
        inodes = set()
        for fd in os.listdir("/proc/self/fd"):
            try:
                target = os.readlink("/proc/self/fd/" + fd)
            except OSError:
                continue
            if target.startswith("socket:["):
                inodes.add(target[8:-1])
        listening = 0
        for path in ("/proc/net/tcp", "/proc/net/tcp6"):
            try:
                with open(path, encoding="utf-8") as fh:
                    for line in fh.read().splitlines()[1:]:
                        parts = line.split()
                        if len(parts) > 9 and parts[3] == "0A" and parts[9] in inodes:
                            listening += 1
            except OSError:
                continue
        caps["network"]["listening_sockets"] = listening
    except OSError:
        caps["network"]["listening_sockets"] = None
    return caps

FPS_CAP = 20.0
HB_TIMEOUT = 10.0


def log(msg):
    line = "%s [body] %s" % (time.strftime("%H:%M:%S"), msg)
    print(line, flush=True)
    try:
        with open(LOG, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except OSError:
        pass


# ---------------------------------------------------------------- sd_notify
def sd_notify(state):
    addr = os.environ.get("NOTIFY_SOCKET")
    if not addr:
        return
    if addr.startswith("@"):
        addr = "\0" + addr[1:]
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
        s.connect(addr)
        s.sendall(state.encode())
        s.close()
    except OSError:
        pass


# ---------------------------------------------------------------- Chrome/CDP
class Chrome:
    def __init__(self):
        self.proc = None
        self.w_in = None
        self.r_out = None
        self.buf = b""
        self.seq = 0
        self.pending = {}
        self.session = None
        self.on_event = None
        self.on_exit = None
        self.lock = threading.Lock()
        self.reader = None

    def start(self):
        r_in, w_in = os.pipe()
        r_out, w_out = os.pipe()
        cmd = (
            "exec 3<&{r} 4>&{w}; exec {bin} --no-sandbox "
            "--enable-unsafe-swiftshader --use-angle=gl --ignore-gpu-blocklist "
            "--remote-debugging-pipe --window-size=1280,720 --hide-scrollbars "
            "--force-device-scale-factor=1 {start}"
        ).format(r=r_in, w=w_out, bin='"' + BIN + '"',
                 start=(('"' + START_URL + '"') if START_URL else 'about:blank'))
        env = dict(os.environ)
        env["LD_LIBRARY_PATH"] = DEPS
        self.proc = subprocess.Popen(
            ["/bin/bash", "-c", cmd], env=env,
            pass_fds=(r_in, w_out), close_fds=True,
        )
        os.close(r_in)
        os.close(w_out)
        self.w_in = w_in
        self.r_out = r_out
        self.buf = b""
        self.session = None
        self.reader = threading.Thread(target=self._read_loop, daemon=True)
        self.reader.start()
        threading.Thread(target=self._wait_loop, args=(self.proc,), daemon=True).start()
        log("chrome 启动 pid=%s" % self.proc.pid)

    def _wait_loop(self, proc):
        rc = proc.wait()          # SIGCHLD：不轮询
        log("chrome 退出 rc=%s" % rc)
        if self.on_exit:
            try:
                self.on_exit()
            except Exception as exc:  # noqa: BLE001
                log("on_exit 异常 %r" % (exc,))

    def _read_loop(self):
        while True:
            try:
                chunk = os.read(self.r_out, 65536)
            except OSError:
                return
            if not chunk:
                return
            self.buf += chunk
            while b"\0" in self.buf:
                raw, self.buf = self.buf.split(b"\0", 1)
                try:
                    obj = json.loads(raw)
                except Exception:
                    continue
                mid = obj.get("id")
                if mid in self.pending:
                    self.pending[mid] = obj
                elif self.on_event:
                    try:
                        self.on_event(obj)
                    except Exception as exc:  # noqa: BLE001
                        log("on_event 异常 %r" % (exc,))

    def send(self, method, params=None, session=None):
        with self.lock:
            self.seq += 1
            mid = self.seq
            msg = {"id": mid, "method": method, "params": params or {}}
            if session:
                msg["sessionId"] = session
            self.pending[mid] = None
            os.write(self.w_in, json.dumps(msg).encode() + b"\0")
            return mid

    def call(self, method, params=None, session=None, timeout=8.0):
        mid = self.send(method, params, session)
        t0 = time.time()
        while time.time() - t0 < timeout:
            got = self.pending.get(mid)
            if got is not None:
                self.pending.pop(mid, None)
                return got
            time.sleep(0.01)
        self.pending.pop(mid, None)
        return {"error": "timeout: " + method}

    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()


# ---------------------------------------------------------------- Body
class Body:
    def __init__(self):
        self.chrome = Chrome()
        self.chrome.on_event = self.on_cdp_event
        self.chrome.on_exit = self.on_chrome_exit
        self.sock = None
        self.sock_lock = threading.Lock()
        self.last_hb = time.time()
        self.last_frame_sent = 0.0
        self.frame_no = 0
        self.ready_sent = False

    # ---- chrome lifecycle
    def boot(self):
        if os.environ.get("FB_BROWSER", "1") == "0":
            log("FB_BROWSER=0，浏览器客户端关闭（不启动 Chrome）")
            return True
        self.chrome.start()
        t0 = time.time()
        while time.time() - t0 < 15:
            r = self.chrome.call("Target.getTargets", timeout=2)
            infos = (r or {}).get("result", {}).get("targetInfos", [])
            page = next((t for t in infos if t.get("type") == "page"), None)
            if page:
                at = self.chrome.call(
                    "Target.attachToTarget",
                    {"targetId": page["targetId"], "flatten": True}, timeout=3)
                sid = (at or {}).get("result", {}).get("sessionId")
                if sid:
                    self.chrome.session = sid
                    self.chrome.call("Page.enable", {}, sid)
                    self.chrome.call("Runtime.enable", {}, sid)
                    self.chrome.call("Log.enable", {}, sid)
                    self.chrome.call("Runtime.addBinding", {"name": "__fb_hb"}, sid)
                    self.chrome.call("Page.addScriptToEvaluateOnNewDocument", {
                        "source": "setInterval(function(){try{window.__fb_hb&&window.__fb_hb(String(Date.now()))}catch(e){}},2000)"
                    }, sid)
                    if not START_URL:
                        self.navigate(self.placeholder_url())
                    res = self.chrome.call("Page.startScreencast", {
                        "format": "jpeg", "quality": 62,
                        "maxWidth": 1280, "maxHeight": 720, "everyNthFrame": 1,
                    }, sid)
                    log("startScreencast -> %s" % json.dumps(res)[:160])
                    self.last_hb = time.time()
                    log("页面已挂载 session=%s" % sid)
                    if not self.ready_sent:
                        sd_notify("READY=1")
                        self.ready_sent = True
                    return True
            time.sleep(0.3)
        log("挂载页面失败")
        return False

    def on_chrome_exit(self):
        log("准备重启 chrome")
        time.sleep(0.5)
        self.ready_sent = False
        self.boot()

    def placeholder_url(self):
        html = """<body style="margin:0;background:#0b0d12;overflow:hidden;font-family:system-ui">
<div style="position:absolute;inset:0;background:radial-gradient(circle at 50% 40%,#16213a,#07090d)"></div>
<div id=b style="position:absolute;top:250px;left:0;width:150px;height:150px;border-radius:28px;
background:linear-gradient(135deg,#6ea8ff,#8b5cf6);box-shadow:0 0 70px #6ea8ff77"></div>
<div style="position:absolute;bottom:70px;width:100%;text-align:center;color:#cfd8ef;font-size:40px;font-weight:700">fishbowl body</div>
<script>let x=0;const b=document.getElementById('b');
setInterval(()=>{x=(x+5)%1130;b.style.transform='translateX('+x+'px)'},16)</script></body>"""
        return "data:text/html;charset=utf-8," + urllib.parse.quote(html)

    def navigate(self, url):
        if not self.chrome.session:
            return
        self.chrome.call("Page.navigate", {"url": url}, self.chrome.session)

        def _restart():
            time.sleep(1.5)
            # 导航会打断 screencast，必须重新开
            self.chrome.call("Page.startScreencast", {
                "format": "jpeg", "quality": 62,
                "maxWidth": 1280, "maxHeight": 720, "everyNthFrame": 1,
            }, self.chrome.session)
            self.last_hb = time.time()

        threading.Thread(target=_restart, daemon=True).start()

    # ---- CDP events
    def on_cdp_event(self, obj):
        method = obj.get("method")
        params = obj.get("params") or {}
        if method == "Page.screencastFrame":
            sid = params.get("sessionId")
            if sid:
                # 关键：ack 必须带目标会话 sessionId，否则 Chrome 三帧后停发
                self.chrome.send("Page.screencastFrameAck", {"sessionId": sid},
                                 session=self.chrome.session)
            self.seen = getattr(self, "seen", 0) + 1
            if self.seen <= 3 or self.seen % 50 == 0:
                log("screencastFrame #%d len=%d sock=%s" %
                    (self.seen, len(params.get("data") or ""), bool(self.sock)))
            now = time.time()
            if now - self.last_frame_sent < 1.0 / FPS_CAP:
                return
            self.last_frame_sent = now
            self.frame_no += 1
            self.push({"t": "frame", "n": self.frame_no, "ts": int(now * 1000),
                       "b64": params.get("data")})
        elif method == "Runtime.bindingCalled" and params.get("name") == "__fb_hb":
            self.last_hb = time.time()
        elif method == "Runtime.consoleAPICalled":
            args = params.get("args") or []
            text = " ".join(str(a.get("value", a.get("description", ""))) for a in args)
            self.push({"t": "log", "msg": ("[console] " + text)[:600]})
        elif method == "Log.entryAdded":
            entry = params.get("entry") or {}
            self.push({"t": "log", "msg": ("[log] " + str(entry.get("text", "")))[:600]})
        elif method in ("Inspector.targetCrashed", "Target.targetDestroyed"):
            log("CDP 报崩溃/销毁：%s" % method)
            self.on_chrome_exit()

    # ---- host link
    def push(self, obj):
        with self.sock_lock:
            if not self.sock:
                return
            try:
                self.sock.sendall((json.dumps(obj, separators=(",", ":")) + "\n").encode())
            except OSError:
                self.sock = None

    def link_loop(self):
        backoff = 1.0
        while True:
            try:
                s = socket.create_connection((HOST, PORT), timeout=5)
                s.settimeout(None)
                with self.sock_lock:
                    self.sock = s
                log("已连上宿主 %s:%d" % (HOST, PORT))
                s.sendall((json.dumps({"t": "hello", "role": "body", "pid": os.getpid(),
                                       "session": self.chrome.session,
                                       "caps": collect_caps()}) + "\n").encode())
                backoff = 1.0
                self.read_host(s)
            except OSError as exc:
                with self.sock_lock:
                    self.sock = None
                log("宿主连接失败 %r，%.0fs 后重试" % (exc, backoff))
                time.sleep(backoff)
                backoff = min(backoff * 2, 15)

    def read_host(self, s):
        buf = b""
        while True:
            chunk = s.recv(65536)
            if not chunk:
                log("read_host 收到 EOF（对端关闭）")
                return
            buf += chunk
            while b"\n" in buf:
                raw, buf = buf.split(b"\n", 1)
                if not raw.strip():
                    continue
                try:
                    msg = json.loads(raw)
                except Exception:
                    continue
                self.handle_host_msg(msg)

    def handle_host_msg(self, msg):
        t = msg.get("t")
        if t == "cdp":
            res = self.chrome.call(msg.get("method"), msg.get("params") or {},
                                   msg.get("session") or self.chrome.session)
            self.push({"t": "cdp", "id": msg.get("id"), "res": res})
        elif t == "navigate":
            self.navigate(msg.get("url", "about:blank"))
            self.push({"t": "cdp", "id": msg.get("id"), "res": {"ok": True}})
        elif t == "ping":
            self.push({"t": "pong", "ts": int(time.time() * 1000)})

    def watchdog_loop(self):
        while True:
            time.sleep(5)
            sd_notify("WATCHDOG=1")
            if self.chrome.session and time.time() - self.last_hb > HB_TIMEOUT:
                log("页面心跳超时 %.0fs，重启 chrome" % (time.time() - self.last_hb))
                self.last_hb = time.time()      # 避免重启过程中重复触发
                self.chrome.stop()              # 退出由 waitpid 感知 → on_chrome_exit → boot
                time.sleep(2)
            self.push({"t": "hb", "ts": int(time.time() * 1000)})

    def run(self):
        if not self.boot():
            sd_notify("STATUS=chrome boot failed")
        threading.Thread(target=self.watchdog_loop, daemon=True).start()
        self.link_loop()


if __name__ == "__main__":
    Body().run()
