import socket, time, json
s = socket.create_connection(('127.0.0.1', 9224), timeout=5)
s.settimeout(None)
s.sendall((json.dumps({'t':'hello','role':'probe','pid':123})+'\n').encode())
print('connected', flush=True)
s.settimeout(1.0)
for i in range(45):
    try:
        s.sendall((json.dumps({'t':'hb','ts':int(time.time()*1000)})+'\n').encode())
        print(i, 'sent', flush=True)
    except Exception as e:
        print(i, 'send error', e, flush=True)
        break
    time.sleep(1)
print('done', flush=True)
