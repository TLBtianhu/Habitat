#!/usr/bin/env python3
"""把 WSL 内 127.0.0.1:3007 暴露到 0.0.0.0:3008，只放行 127.0.0.1 来源。"""
import socket, threading, sys

LISTEN = ("0.0.0.0", 3008)
TARGET = ("127.0.0.1", 3007)

def pipe(src, dst):
    try:
        while True:
            d = src.recv(65536)
            if not d: break
            dst.sendall(d)
    except OSError:
        pass
    finally:
        for s in (src, dst):
            try: s.shutdown(socket.SHUT_WR)
            except OSError: pass

def handle(c, addr):
    if addr[0] != "127.0.0.1":
        c.close(); return
    try:
        u = socket.create_connection(TARGET, timeout=5)
    except OSError as e:
        print("connect failed", e, file=sys.stderr); c.close(); return
    threading.Thread(target=pipe, args=(c, u), daemon=True).start()
    threading.Thread(target=pipe, args=(u, c), daemon=True).start()

srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(LISTEN); srv.listen(64)
print("viewer-relay 0.0.0.0:3008 -> 127.0.0.1:3007", flush=True)
while True:
    c, a = srv.accept()
    threading.Thread(target=handle, args=(c, a), daemon=True).start()
