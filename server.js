const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Файл базы данных аккаунтов (на Amvera примонтируем в /data или рядом)
const DATA_DIR = fs.existsSync('/data') ? '/data' : __dirname;
const DB_FILE = path.join(DATA_DIR, 'accounts.json');

let accounts = {};
try {
  if (fs.existsSync(DB_FILE)) accounts = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
} catch (e) { console.error('Ошибка чтения БД:', e); }

function saveDB() {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(accounts, null, 2)); } catch (e) {}
}

// API Входа и Регистрации аккаунта (логин / Google-почта + пароль)
app.post('/api/auth', (req, res) => {
  const { login, password, mode } = req.body || {};
  const cleanLogin = String(login || '').trim().toLowerCase();
  if (!cleanLogin || !password) return res.json({ ok: false, error: 'Введите логин/почту и пароль' });

  if (mode === 'register') {
    if (accounts[cleanLogin]) return res.json({ ok: false, error: 'Этот логин уже занят!' });
    const pid = 'P' + Math.floor(1000 + Math.random() * 9000);
    accounts[cleanLogin] = { login: cleanLogin, password, pid, save: null, updatedAt: Date.now() };
    saveDB();
    return res.json({ ok: true, pid, login: cleanLogin, save: null });
  } else {
    const acc = accounts[cleanLogin];
    if (!acc || acc.password !== password) return res.json({ ok: false, error: 'Неверный логин или пароль' });
    return res.json({ ok: true, pid: acc.pid, login: cleanLogin, save: acc.save });
  }
});

// API Облачного сохранения прогресса
app.post('/api/save', (req, res) => {
  const { login, password, save } = req.body || {};
  const cleanLogin = String(login || '').trim().toLowerCase();
  const acc = accounts[cleanLogin];
  if (!acc || acc.password !== password) return res.json({ ok: false });
  acc.save = save;
  acc.updatedAt = Date.now();
  saveDB();
  res.json({ ok: true });
});

const apiaries = new Map();

function broadcastFriendList() {
  const list = Array.from(apiaries.values()).map(p => ({
    id: p.id, name: p.name, level: p.level, hivesCount: p.hivesCount, weeds: p.weeds,
    online: p.ws && p.ws.readyState === WebSocket.OPEN
  }));
  const msg = JSON.stringify({ type: 'PLAYERS_LIST', list });
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

wss.on('connection', (ws) => {
  let currentId = null;

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);
      if (data.type === 'REGISTER_APIARY') {
        currentId = data.id;
        apiaries.set(currentId, { id: data.id, name: data.name || 'Пчеловод', level: data.level || 1, hivesCount: 1, weeds: 0, state: data.state, ws });
        broadcastFriendList();
      }
      if (data.type === 'VISIT_APIARY') {
        const target = apiaries.get(data.targetId);
        if (target) ws.send(JSON.stringify({ type: 'VISIT_DATA', owner: { id: target.id, name: target.name }, state: target.state }));
      }
      if (data.type === 'HELP_FRIEND') {
        const target = apiaries.get(data.targetId);
        if (target?.ws?.readyState === WebSocket.OPEN) {
          target.ws.send(JSON.stringify({ type: 'FRIEND_HELPED', helperName: data.helperName, action: data.action }));
        }
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    if (currentId && apiaries.has(currentId)) {
      apiaries.get(currentId).ws = null;
      broadcastFriendList();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер Пасеки запущен: http://localhost:${PORT}`));
