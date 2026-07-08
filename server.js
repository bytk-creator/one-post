const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const formidable = require('formidable');
const initSqlJs = require('sql.js');

const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const CACHE = new Map();

[UPLOADS_DIR, path.join(__dirname, 'public', 'css'), path.join(__dirname, 'public', 'js')].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const DB_PATH = path.join(DATA_DIR, 'database.db');

let db;

function saveDb() {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
}

async function initDb() {
    const SQL = await initSqlJs();
    db = fs.existsSync(DB_PATH) ? new SQL.Database(fs.readFileSync(DB_PATH)) : new SQL.Database();
    db.run('PRAGMA journal_mode=WAL'); db.run('PRAGMA synchronous=NORMAL'); db.run('PRAGMA cache_size=-8000');
    db.run(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, bio TEXT DEFAULT '', avatarUrl TEXT, createdAt TEXT NOT NULL)`);
    db.run(`CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, userId TEXT NOT NULL, createdAt TEXT NOT NULL)`);
    db.run(`CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, userId TEXT NOT NULL, content TEXT NOT NULL, imageUrl TEXT, date TEXT NOT NULL, time TEXT NOT NULL)`);
    db.run(`CREATE TABLE IF NOT EXISTS likes (userId TEXT NOT NULL, postId TEXT NOT NULL, time TEXT NOT NULL, PRIMARY KEY (userId, postId))`);
    db.run(`CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, fromUserId TEXT NOT NULL, toUserId TEXT NOT NULL, text TEXT NOT NULL, time TEXT NOT NULL, read INTEGER DEFAULT 0)`);
    db.run('CREATE INDEX IF NOT EXISTS idx_posts_userId_date ON posts(userId, date)');
    db.run('CREATE INDEX IF NOT EXISTS idx_posts_time ON posts(time DESC)');
    db.run('CREATE INDEX IF NOT EXISTS idx_likes_postId ON likes(postId)');
    db.run('CREATE INDEX IF NOT EXISTS idx_likes_userId ON likes(userId)');
    db.run('CREATE INDEX IF NOT EXISTS idx_messages_users ON messages(fromUserId, toUserId)');
    db.run('CREATE INDEX IF NOT EXISTS idx_messages_time ON messages(time)');
    db.run('CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)');
    saveDb();
}

function hashPassword(p) { return crypto.createHash('sha256').update(p).digest('hex'); }

function readBody(req) {
    return new Promise(resolve => {
        let body = '';
        req.on('data', c => { body += c.toString(); });
        req.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { resolve({}); } });
    });
}

function parseFormData(req) {
    return new Promise(resolve => {
        const form = new formidable.IncomingForm({ uploadDir: UPLOADS_DIR, keepExtensions: true, maxFileSize: 10 * 1024 * 1024 });
        form.parse(req, (err, fields, files) => {
            if (err) { resolve({ fields: {}, files: {} }); return; }
            const cf = {}; Object.keys(fields).forEach(k => { cf[k] = Array.isArray(fields[k]) ? fields[k][0] : fields[k]; });
            resolve({ fields: cf, files });
        });
    });
}

function getAuth(req) {
    const token = (req.headers['authorization'] || '').replace('Bearer ', '');
    if (!token) return null;
    const s = queryOne('SELECT * FROM sessions WHERE token = ?', [token]);
    return s ? queryOne('SELECT * FROM users WHERE id = ?', [s.userId]) : null;
}

function serveJSON(res, data, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
}

function serveFile(res, filePath, contentType, cache = true) {
    if (cache && CACHE.has(filePath)) {
        res.writeHead(200, CACHE.get(filePath).headers);
        return res.end(CACHE.get(filePath).data);
    }
    const fullPath = path.join(__dirname, filePath);
    try {
        const data = fs.readFileSync(fullPath);
        const headers = { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=86400' };
        if (cache) CACHE.set(filePath, { data, headers });
        res.writeHead(200, headers);
        res.end(data);
    } catch (e) { res.writeHead(404); res.end('Not found'); }
}

function serveBinaryFile(res, filePath) {
    const fullPath = path.join(__dirname, filePath);
    const ext = path.extname(fullPath).toLowerCase();
    const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' }[ext] || 'application/octet-stream';
    res.setHeader('Cache-Control', 'public, max-age=86400');
    try { const data = fs.readFileSync(fullPath); res.writeHead(200, { 'Content-Type': mime }); res.end(data); } catch (e) { res.writeHead(404); res.end('Not found'); }
}

function queryOne(sql, params = []) { const s = db.prepare(sql); s.bind(params); const r = s.step() ? s.getAsObject() : null; s.free(); return r; }
function queryAll(sql, params = []) { const s = db.prepare(sql); s.bind(params); const rows = []; while (s.step()) rows.push(s.getAsObject()); s.free(); return rows; }
function runSql(sql, params = []) { db.run(sql, params); saveDb(); }

function parseLastMsg(t) { if (!t) return ''; try { const p = JSON.parse(t); return p.imageUrl ? '📷 Фото' : (p.text || t); } catch (e) { return t; } }
function parseMsgText(t) { try { const p = JSON.parse(t); return { text: p.text || '', imageUrl: p.imageUrl || null }; } catch (e) { return { text: t, imageUrl: null }; } }

const server = http.createServer(async (req, res) => {
    const url = req.url.split('?')[0];
    const method = req.method;
    const currentUser = getAuth(req);

    // Статика
    if (url.startsWith('/uploads/') && method === 'GET') return serveBinaryFile(res, 'public' + url);
    if (url === '/' || url === '/index.html') return serveFile(res, 'public/index.html', 'text/html; charset=utf-8');
    if (url === '/css/style.css') return serveFile(res, 'public/css/style.css', 'text/css; charset=utf-8');
    if (url === '/js/app.js') return serveFile(res, 'public/js/app.js', 'application/javascript; charset=utf-8');

    // AUTH
    if (url === '/api/register' && method === 'POST') {
        const { username, password } = await readBody(req);
        if (!username || !password) return serveJSON(res, { error: 'Логин и пароль обязательны' }, 400);
        if (username.length < 3 || password.length < 4) return serveJSON(res, { error: 'Логин от 3, пароль от 4 символов' }, 400);
        if (queryOne('SELECT id FROM users WHERE username = ?', [username])) return serveJSON(res, { error: 'Пользователь уже существует' }, 400);
        const uid = Date.now().toString();
        runSql('INSERT INTO users (id, username, password, bio, avatarUrl, createdAt) VALUES (?,?,?,?,?,?)', [uid, username, hashPassword(password), '', null, new Date().toISOString()]);
        const token = crypto.randomBytes(32).toString('hex');
        runSql('INSERT OR REPLACE INTO sessions (token, userId, createdAt) VALUES (?,?,?)', [token, uid, new Date().toISOString()]);
        return serveJSON(res, { success: true, token, user: { id: uid, username } });
    }
    if (url === '/api/login' && method === 'POST') {
        const { username, password } = await readBody(req);
        const user = queryOne('SELECT * FROM users WHERE username = ?', [username]);
        if (!user || user.password !== hashPassword(password)) return serveJSON(res, { error: 'Неверный логин или пароль' }, 401);
        const token = crypto.randomBytes(32).toString('hex');
        runSql('INSERT OR REPLACE INTO sessions (token, userId, createdAt) VALUES (?,?,?)', [token, user.id, new Date().toISOString()]);
        return serveJSON(res, { success: true, token, user: { id: user.id, username: user.username } });
    }
    if (url === '/api/me' && method === 'GET') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const today = new Date().toISOString().split('T')[0];
        const c = queryOne('SELECT COUNT(*) as count FROM posts WHERE userId=? AND date=?', [currentUser.id, today]);
        return serveJSON(res, { user: { ...currentUser, bio: currentUser.bio || '' }, canPost: c.count === 0 });
    }

    // USERS
    if (url.match(/^\/api\/user\/[^/]+$/) && method === 'GET') {
        const uid = url.split('/')[3];
        const user = queryOne('SELECT * FROM users WHERE id=?', [uid]);
        if (!user) return serveJSON(res, { error: 'Пользователь не найден' }, 404);
        const posts = queryAll('SELECT date FROM posts WHERE userId=? ORDER BY date DESC', [uid]);
        const dates = [...new Set(posts.map(p => p.date))];
        let streak = 0;
        const today = new Date().toISOString().split('T')[0];
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        if (dates.length && (dates[0] === today || dates[0] === yesterday)) {
            streak = 1;
            for (let i = 1; i < dates.length; i++) {
                const prev = new Date(dates[i-1]); prev.setDate(prev.getDate() - 1);
                if (dates[i] === prev.toISOString().split('T')[0]) streak++; else break;
            }
        }
        return serveJSON(res, { ...user, bio: user.bio || '', totalPosts: posts.length, streak });
    }
    if (url.match(/^\/api\/user\/[^/]+\/posts$/) && method === 'GET') {
        const uid = url.split('/')[3];
        const user = queryOne('SELECT * FROM users WHERE id=?', [uid]);
        if (!user) return serveJSON(res, { error: 'Пользователь не найден' }, 404);
        return serveJSON(res, queryAll('SELECT * FROM posts WHERE userId=? ORDER BY time DESC', [uid]).map(p => ({ ...p, author: user.username, authorAvatar: user.avatarUrl })));
    }
    if (url.startsWith('/api/users/search') && method === 'GET') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const q = (new URL(req.url, 'http://localhost').searchParams.get('q') || '').trim();
        if (!q) return serveJSON(res, []);
        return serveJSON(res, queryAll('SELECT id, username FROM users WHERE username LIKE ? AND id!=? LIMIT 10', [`%${q}%`, currentUser.id]).map(u => ({ id: String(u.id), username: u.username })));
    }

    // POSTS
    if (url === '/api/post' && method === 'POST') {
        if (!currentUser) return serveJSON(res, { error: 'Войдите' }, 401);
        const today = new Date().toISOString().split('T')[0];
        if (queryOne('SELECT COUNT(*) as count FROM posts WHERE userId=? AND date=?', [currentUser.id, today]).count > 0) return serveJSON(res, { error: 'Уже публиковали сегодня' }, 400);
        const { fields, files } = await parseFormData(req);
        const content = (fields.content || '').trim();
        if (!content) return serveJSON(res, { error: 'Пост пуст' }, 400);
        let img = null;
        if (files.image && files.image[0]) {
            const f = files.image[0];
            const fn = Date.now() + '-' + crypto.randomBytes(4).toString('hex') + path.extname(f.originalFilename || '.jpg');
            fs.renameSync(f.filepath, path.join(UPLOADS_DIR, fn));
            img = '/uploads/' + fn;
        }
        const pid = Date.now().toString();
        runSql('INSERT INTO posts (id,userId,content,imageUrl,date,time) VALUES (?,?,?,?,?,?)', [pid, currentUser.id, content, img, today, new Date().toISOString()]);
        return serveJSON(res, { success: true, post: { id: pid, content, imageUrl: img, author: currentUser.username } });
    }
    if (url === '/api/posts' && method === 'GET') {
        const p = parseInt((new URL(req.url, 'http://localhost').searchParams.get('page') || '1'));
        const limit = 20, offset = (p - 1) * limit;
        return serveJSON(res, queryAll('SELECT posts.*, users.username as author, users.avatarUrl as authorAvatar FROM posts JOIN users ON posts.userId=users.id ORDER BY posts.time DESC LIMIT ? OFFSET ?', [limit, offset]));
    }
    if (url.match(/^\/api\/post\/[^/]+$/) && method === 'DELETE') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const pid = url.split('/')[3];
        const post = queryOne('SELECT * FROM posts WHERE id=?', [pid]);
        if (!post) return serveJSON(res, { error: 'Не найден' }, 404);
        if (post.userId !== currentUser.id) return serveJSON(res, { error: 'Не ваш пост' }, 403);
        if (post.imageUrl) { const fp = path.join(__dirname, 'public', post.imageUrl); if (fs.existsSync(fp)) fs.unlinkSync(fp); }
        runSql('DELETE FROM likes WHERE postId=?', [pid]); runSql('DELETE FROM posts WHERE id=?', [pid]);
        return serveJSON(res, { success: true });
    }

    // LIKES
    if (url === '/api/like' && method === 'POST') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const { postId } = await readBody(req);
        const ex = queryOne('SELECT * FROM likes WHERE userId=? AND postId=?', [currentUser.id, postId]);
        if (ex) runSql('DELETE FROM likes WHERE userId=? AND postId=?', [currentUser.id, postId]);
        else runSql('INSERT INTO likes (userId,postId,time) VALUES (?,?,?)', [currentUser.id, postId, new Date().toISOString()]);
        const count = queryOne('SELECT COUNT(*) as count FROM likes WHERE postId=?', [postId]).count;
        return serveJSON(res, { liked: !ex, count });
    }
    if (url === '/api/likes' && method === 'POST') {
        const { postIds } = await readBody(req);
        if (!postIds || !postIds.length) return serveJSON(res, {});
        const my = currentUser ? queryAll('SELECT postId FROM likes WHERE userId=?', [currentUser.id]).map(r => r.postId) : [];
        const result = {};
        const ph = postIds.map(() => '?').join(',');
        const counts = queryAll(`SELECT postId, COUNT(*) as count FROM likes WHERE postId IN (${ph}) GROUP BY postId`, postIds);
        const cm = {}; counts.forEach(c => { cm[c.postId] = c.count; });
        postIds.forEach(pid => { result[pid] = { count: cm[pid] || 0, liked: my.includes(pid) }; });
        return serveJSON(res, result);
    }

    // MESSAGES
    if (url === '/api/dialogs' && method === 'GET') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const partners = queryAll('SELECT DISTINCT CASE WHEN fromUserId=? THEN toUserId ELSE fromUserId END as partnerId FROM messages WHERE fromUserId=? OR toUserId=?', [currentUser.id, currentUser.id, currentUser.id]);
        const dialogs = [];
        for (const p of partners) {
            const partner = queryOne('SELECT * FROM users WHERE id=?', [String(p.partnerId)]);
            if (!partner) continue;
            const lm = queryOne('SELECT * FROM messages WHERE (fromUserId=? AND toUserId=?) OR (fromUserId=? AND toUserId=?) ORDER BY time DESC LIMIT 1', [currentUser.id, partner.id, partner.id, currentUser.id]);
            const unread = queryOne('SELECT COUNT(*) as count FROM messages WHERE toUserId=? AND fromUserId=? AND read=0', [currentUser.id, partner.id]).count;
            dialogs.push({ userId: String(partner.id), username: partner.username, avatarUrl: partner.avatarUrl, lastMessage: lm ? parseLastMsg(lm.text) : '', lastTime: lm ? lm.time : '', unread });
        }
        dialogs.sort((a, b) => b.lastTime.localeCompare(a.lastTime));
        return serveJSON(res, dialogs);
    }
    if (url.startsWith('/api/messages/') && !url.includes('/photo') && method === 'GET') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const partnerId = url.split('/')[3];
        const params = new URL(req.url, 'http://localhost').searchParams;
        const before = params.get('before');
        const limit = 30;
        
        runSql('UPDATE messages SET read=1 WHERE fromUserId=? AND toUserId=? AND read=0', [partnerId, currentUser.id]);
        
        let sql = 'SELECT messages.*, u1.username as fromUsername, u2.username as toUsername FROM messages JOIN users u1 ON messages.fromUserId=u1.id JOIN users u2 ON messages.toUserId=u2.id WHERE ((fromUserId=? AND toUserId=?) OR (fromUserId=? AND toUserId=?))';
        const sqlParams = [currentUser.id, partnerId, partnerId, currentUser.id];
        if (before) { sql += ' AND messages.time < ?'; sqlParams.push(before); }
        sql += ' ORDER BY messages.time DESC LIMIT ?';
        sqlParams.push(limit);
        
        const messages = queryAll(sql, sqlParams).reverse();
        const hasMore = messages.length === limit;
        
        const fixed = messages.map(m => {
            const parsed = parseMsgText(m.text);
            return { id: String(m.id), from: String(m.fromUserId), to: String(m.toUserId), fromUserId: String(m.fromUserId), toUserId: String(m.toUserId), text: parsed.text, imageUrl: parsed.imageUrl, time: m.time, read: m.read, fromUsername: m.fromUsername, toUsername: m.toUsername };
        });
        return serveJSON(res, { messages: fixed, hasMore });
    }
    if (url === '/api/messages/photo' && method === 'POST') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const { fields, files } = await parseFormData(req);
        const to = fields.to;
        if (!to) return serveJSON(res, { error: 'Получатель обязателен' }, 400);
        if (String(to) === String(currentUser.id)) return serveJSON(res, { error: 'Нельзя себе' }, 400);
        let img = null;
        if (files.image && files.image[0]) {
            const f = files.image[0];
            const fn = 'chat-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + path.extname(f.originalFilename || '.jpg');
            fs.renameSync(f.filepath, path.join(UPLOADS_DIR, fn));
            img = '/uploads/' + fn;
        }
        const mid = Date.now().toString();
        runSql('INSERT INTO messages (id,fromUserId,toUserId,text,time,read) VALUES (?,?,?,?,?,0)', [mid, currentUser.id, String(to), JSON.stringify({ text: (fields.text || '').trim(), imageUrl: img }), new Date().toISOString()]);
        return serveJSON(res, { success: true, message: { id: mid, from: String(currentUser.id), to: String(to), text: fields.text || '', imageUrl: img, fromUsername: currentUser.username } });
    }
    if (url === '/api/messages' && method === 'POST') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const { to, text } = await readBody(req);
        if (!to || !text || !text.trim()) return serveJSON(res, { error: 'Текст обязателен' }, 400);
        if (String(to) === String(currentUser.id)) return serveJSON(res, { error: 'Нельзя себе' }, 400);
        const mid = Date.now().toString();
        runSql('INSERT INTO messages (id,fromUserId,toUserId,text,time,read) VALUES (?,?,?,?,?,0)', [mid, currentUser.id, String(to), text.trim(), new Date().toISOString()]);
        return serveJSON(res, { success: true, message: { id: mid, from: String(currentUser.id), to: String(to), text: text.trim(), fromUsername: currentUser.username } });
    }
    if (url === '/api/unread' && method === 'GET') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        return serveJSON(res, { count: queryOne('SELECT COUNT(*) as count FROM messages WHERE toUserId=? AND read=0', [currentUser.id]).count });
    }

    // SETTINGS
    if (url === '/api/settings' && method === 'GET') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        return serveJSON(res, { username: currentUser.username, bio: currentUser.bio || '', avatarUrl: currentUser.avatarUrl });
    }
    if (url === '/api/settings' && method === 'POST') {
        if (!currentUser) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const ct = req.headers['content-type'] || '';
        if (ct.includes('multipart/form-data')) {
            const { files } = await parseFormData(req);
            if (files.avatar && files.avatar[0]) {
                const f = files.avatar[0];
                const fn = 'avatar-' + currentUser.id + path.extname(f.originalFilename || '.jpg');
                if (currentUser.avatarUrl) { const op = path.join(__dirname, 'public', currentUser.avatarUrl); if (fs.existsSync(op)) fs.unlinkSync(op); }
                fs.renameSync(f.filepath, path.join(UPLOADS_DIR, fn));
                const url = '/uploads/' + fn;
                runSql('UPDATE users SET avatarUrl=? WHERE id=?', [url, currentUser.id]);
                return serveJSON(res, { success: true, avatarUrl: url });
            }
            return serveJSON(res, { success: true });
        }
        const { username, password, bio } = await readBody(req);
        const nu = username !== undefined ? username.trim() : currentUser.username;
        const np = password && password.trim() ? hashPassword(password.trim()) : currentUser.password;
        const nb = bio !== undefined ? (bio || '').substring(0, 200) : (currentUser.bio || '');
        if (nu.length < 3) return serveJSON(res, { error: 'Имя от 3 символов' }, 400);
        if (password && password.trim() && password.trim().length < 4) return serveJSON(res, { error: 'Пароль от 4 символов' }, 400);
        runSql('UPDATE users SET username=?, password=?, bio=? WHERE id=?', [nu, np, nb, currentUser.id]);
        return serveJSON(res, { success: true, user: { id: currentUser.id, username: nu, bio: nb, avatarUrl: currentUser.avatarUrl } });
    }

    res.writeHead(404);
    res.end('Not found');
});

initDb().then(() => {
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => console.log('Сервер запущен на порту ' + PORT));
});

setInterval(() => CACHE.clear(), 300000);