const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const formidable = require('formidable');
const initSqlJs = require('sql.js');
const { createWebSocketServer, setDb, setSaveDb } = require('./ws-server');

const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const AUDIO_DIR = path.join(UPLOADS_DIR, 'audio');

// Создаём директории
[DATA_DIR, UPLOADS_DIR, AUDIO_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const DB_PATH = path.join(DATA_DIR, 'database.db');
let db;

function saveDb() {
    if (!db) return;
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
}

async function initDb() {
    const SQL = await initSqlJs();
    if (fs.existsSync(DB_PATH)) {
        const buffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(buffer);
    } else {
        db = new SQL.Database();
    }
    
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
        bio TEXT DEFAULT '', avatarUrl TEXT, coverUrl TEXT DEFAULT '', createdAt TEXT NOT NULL,
        lastSeen TEXT DEFAULT '')`);
    db.run(`CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY, userId TEXT NOT NULL, createdAt TEXT NOT NULL)`);
    db.run(`CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY, userId TEXT NOT NULL, content TEXT NOT NULL,
        imageUrl TEXT, date TEXT NOT NULL, time TEXT NOT NULL)`);
    db.run(`CREATE TABLE IF NOT EXISTS likes (
        userId TEXT NOT NULL, postId TEXT NOT NULL, time TEXT NOT NULL,
        PRIMARY KEY (userId, postId))`);
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, fromUserId TEXT NOT NULL, toUserId TEXT NOT NULL,
        text TEXT NOT NULL, time TEXT NOT NULL, read INTEGER DEFAULT 0)`);
    
    setDb(db);
    setSaveDb(saveDb);
    saveDb();
    
    console.log('✅ БД инициализирована');
}

// Вспомогательные функции
function hashPassword(password) {
    return crypto.createHash('sha256').update(password + 'salt').digest('hex');
}

function serveJSON(res, data, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
}

function serveFile(res, filePath, contentType) {
    const fullPath = path.join(__dirname, filePath);
    fs.readFile(fullPath, 'utf8', (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType + '; charset=utf-8' });
        res.end(data);
    });
}

function serveBinaryFile(res, filePath) {
    const fullPath = path.join(__dirname, filePath);
    const ext = path.extname(fullPath).toLowerCase();
    const mimeTypes = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.png': 'image/png', '.gif': 'image/gif',
        '.webp': 'image/webp', '.webm': 'audio/webm',
        '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg'
    };
    
    fs.readFile(fullPath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }
        res.writeHead(200, { 
            'Content-Type': mimeTypes[ext] || 'application/octet-stream',
            'Cache-Control': 'public, max-age=86400'
        });
        res.end(data);
    });
}

function getAuth(req) {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token || !db) return null;
    
    try {
        const stmt = db.prepare('SELECT * FROM sessions WHERE token = ?');
        stmt.bind([token]);
        if (!stmt.step()) { stmt.free(); return null; }
        const session = stmt.getAsObject();
        stmt.free();
        
        const stmt2 = db.prepare('SELECT * FROM users WHERE id = ?');
        stmt2.bind([session.userId]);
        if (!stmt2.step()) { stmt2.free(); return null; }
        const user = stmt2.getAsObject();
        stmt2.free();
        return user;
    } catch (err) {
        console.error('Auth error:', err);
        return null;
    }
}

function readBody(req) {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try { resolve(JSON.parse(body)); } catch (e) { resolve({}); }
        });
    });
}

function queryOne(sql, params = []) {
    try {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        if (stmt.step()) { const row = stmt.getAsObject(); stmt.free(); return row; }
        stmt.free();
        return null;
    } catch (err) {
        console.error('queryOne error:', err);
        return null;
    }
}

function queryAll(sql, params = []) {
    try {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return rows;
    } catch (err) {
        console.error('queryAll error:', err);
        return [];
    }
}

function runSql(sql, params = []) {
    try {
        db.run(sql, params);
        saveDb();
    } catch (err) {
        console.error('runSql error:', err);
    }
}

// ===== СОЗДАЁМ СЕРВЕР =====
const server = http.createServer(async (req, res) => {
    const url = req.url.split('?')[0];
    const method = req.method;
    const currentUser = getAuth(req);
    
    console.log(`📨 ${method} ${url}`);

    // ===== API МАРШРУТЫ =====
    
    if (url === '/api/register' && method === 'POST') {
        const { username, password } = await readBody(req);
        if (!username || !password) return serveJSON(res, { error: 'Логин и пароль обязательны' }, 400);
        if (username.length < 3) return serveJSON(res, { error: 'Минимум 3 символа' }, 400);
        if (password.length < 4) return serveJSON(res, { error: 'Минимум 4 символа' }, 400);
        
        const exists = queryOne('SELECT id FROM users WHERE username = ?', [username]);
        if (exists) return serveJSON(res, { error: 'Пользователь уже существует' }, 400);
        
        const userId = Date.now().toString();
        runSql('INSERT INTO users (id, username, password, bio, avatarUrl, coverUrl, createdAt, lastSeen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', 
            [userId, username, hashPassword(password), '', null, '', new Date().toISOString(), new Date().toISOString()]);
        
        const token = crypto.randomBytes(32).toString('hex');
        runSql('INSERT INTO sessions (token, userId, createdAt) VALUES (?, ?, ?)', 
            [token, userId, new Date().toISOString()]);
        
        return serveJSON(res, { success: true, token, user: { id: userId, username } });
    }

    if (url === '/api/login' && method === 'POST') {
        const { username, password } = await readBody(req);
        const user = queryOne('SELECT * FROM users WHERE username = ?', [username]);
        if (!user || user.password !== hashPassword(password)) 
            return serveJSON(res, { error: 'Неверный логин или пароль' }, 401);
        
        const token = crypto.randomBytes(32).toString('hex');
        runSql('INSERT INTO sessions (token, userId, createdAt) VALUES (?, ?, ?)', 
            [token, user.id, new Date().toISOString()]);
        runSql('UPDATE users SET lastSeen = ? WHERE id = ?', [new Date().toISOString(), user.id]);
        
        return serveJSON(res, { success: true, token, user: { id: user.id, username: user.username } });
    }

    if (url === '/api/me' && method === 'GET') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const today = new Date().toISOString().split('T')[0];
        const count = queryOne('SELECT COUNT(*) as count FROM posts WHERE userId = ? AND date = ?', [currentUser.id, today]);
        return serveJSON(res, { 
            user: { 
                id: currentUser.id, 
                username: currentUser.username, 
                bio: currentUser.bio || '', 
                avatarUrl: currentUser.avatarUrl, 
                coverUrl: currentUser.coverUrl || '', 
                createdAt: currentUser.createdAt 
            }, 
            canPost: !count || count.count === 0 
        });
    }

    if (url === '/api/ping' && method === 'POST') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        runSql('UPDATE users SET lastSeen = ? WHERE id = ?', [new Date().toISOString(), currentUser.id]);
        return serveJSON(res, { success: true });
    }

    // ===== СТАТИКА =====
    if (url.startsWith('/uploads/') && method === 'GET') {
        return serveBinaryFile(res, 'public' + url);
    }

    if (url === '/css/style.css') return serveFile(res, 'public/css/style.css', 'text/css');
    if (url === '/js/app.js') return serveFile(res, 'public/js/app.js', 'application/javascript');
    if (url === '/manifest.json') return serveFile(res, 'public/manifest.json', 'application/json');
    if (url === '/service-worker.js') return serveFile(res, 'public/service-worker.js', 'application/javascript');

    // ===== SPA =====
    if (method === 'GET' && !url.startsWith('/api/') && !url.startsWith('/uploads/')) {
        return serveFile(res, 'public/index.html', 'text/html');
    }

    // ===== 404 =====
    res.writeHead(404);
    res.end('Not found');
});

// ===== ЗАПУСК =====
initDb().then(() => {
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, '0.0.0.0', () => {
        console.log('🚀 Сервер запущен на порту ' + PORT);
        createWebSocketServer(server);
        console.log('✅ WebSocket интегрирован');
    });
}).catch(err => {
    console.error('❌ Ошибка инициализации:', err);
    process.exit(1);
});
