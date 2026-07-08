const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const formidable = require('formidable');
const initSqlJs = require('sql.js');

const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'database.db');
const STATIC_CACHE = new Map();

let db;

function saveDb() {
    fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

async function initDb() {
    const SQL = await initSqlJs();
    db = fs.existsSync(DB_PATH) ? new SQL.Database(fs.readFileSync(DB_PATH)) : new SQL.Database();
    db.run('PRAGMA journal_mode=WAL');
    db.run(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, bio TEXT DEFAULT '', avatarUrl TEXT, createdAt TEXT NOT NULL)`);
    db.run(`CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, userId TEXT NOT NULL, createdAt TEXT NOT NULL)`);
    db.run(`CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, userId TEXT NOT NULL, content TEXT NOT NULL, imageUrl TEXT, date TEXT NOT NULL, time TEXT NOT NULL)`);
    db.run(`CREATE TABLE IF NOT EXISTS likes (userId TEXT NOT NULL, postId TEXT NOT NULL, time TEXT NOT NULL, PRIMARY KEY (userId, postId))`);
    db.run(`CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, fromUserId TEXT NOT NULL, toUserId TEXT NOT NULL, text TEXT NOT NULL, time TEXT NOT NULL, read INTEGER DEFAULT 0)`);
    db.run('CREATE INDEX IF NOT EXISTS idx_posts_time ON posts(time DESC)');
    db.run('CREATE INDEX IF NOT EXISTS idx_messages_users ON messages(fromUserId, toUserId)');
    db.run('CREATE INDEX IF NOT EXISTS idx_messages_time ON messages(time)');
    saveDb();
}

function hashPassword(p) { return crypto.createHash('sha256').update(p).digest('hex'); }

function readBody(req) {
    return new Promise(resolve => {
        let body = '';
        req.on('data', c => body += c.toString());
        req.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { resolve({}); } });
    });
}

function parseFormData(req) {
    return new Promise(resolve => {
        const form = new formidable.IncomingForm({ uploadDir: UPLOADS_DIR, keepExtensions: true, maxFileSize: 10 * 1024 * 1024 });
        form.parse(req, (err, fields, files) => {
            if (err) return resolve({ fields: {}, files: {} });
            const cf = {};
            Object.keys(fields).forEach(k => cf[k] = Array.isArray(fields[k]) ? fields[k][0] : fields[k]);
            resolve({ fields: cf, files });
        });
    });
}

function getAuth(req) {
    const token = (req.headers['authorization'] || '').replace('Bearer ', '');
    if (!token) return null;
    const s = db.prepare('SELECT * FROM sessions WHERE token = ?').bind([token]);
    if (!s.step()) return null;
    const session = s.getAsObject(); s.free();
    const u = db.prepare('SELECT * FROM users WHERE id = ?').bind([session.userId]);
    if (!u.step()) return null;
    const user = u.getAsObject(); u.free();
    return user;
}

function serveFile(res, filePath, mime) {
    const full = path.join(__dirname, filePath);
    if (STATIC_CACHE.has(filePath)) {
        res.writeHead(200, STATIC_CACHE.get(filePath).headers);
        return res.end(STATIC_CACHE.get(filePath).data);
    }
    try {
        const data = fs.readFileSync(full);
        const headers = { 'Content-Type': mime, 'Cache-Control': 'public, max-age=3600' };
        STATIC_CACHE.set(filePath, { data, headers });
        res.writeHead(200, headers);
        res.end(data);
    } catch (e) { res.writeHead(404); res.end('Not found'); }
}

function serveBinary(res, filePath) {
    const full = path.join(__dirname, filePath);
    const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' }[path.extname(full).toLowerCase()] || 'application/octet-stream';
    res.setHeader('Cache-Control', 'public, max-age=86400');
    try { const d = fs.readFileSync(full); res.writeHead(200, { 'Content-Type': mime }); res.end(d); } catch (e) { res.writeHead(404); res.end('Not found'); }
}

function serveJSON(res, data, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
}

function q1(sql, p = []) { const s = db.prepare(sql).bind(p); const r = s.step() ? s.getAsObject() : null; s.free(); return r; }
function qa(sql, p = []) { const s = db.prepare(sql).bind(p); const rows = []; while (s.step()) rows.push(s.getAsObject()); s.free(); return rows; }
function run(sql, p = []) { db.run(sql, p); saveDb(); }

function lastMsgText(t) {
    if (!t) return '';
    try { const p = JSON.parse(t); return p.imageUrl ? '📷 Фото' : (p.text || t); } catch (e) { return t; }
}
function parseMsg(t) {
    try { const p = JSON.parse(t); return { text: p.text || '', imageUrl: p.imageUrl || null }; } catch (e) { return { text: t, imageUrl: null }; }
}

const server = http.createServer(async (req, res) => {
    const url = req.url.split('?')[0];
    const m = req.method;
    const u = getAuth(req);

    if (m === 'GET' && url.startsWith('/uploads/')) return serveBinary(res, 'public' + url);

    if (url === '/api/register' && m === 'POST') {
        const { username, password } = await readBody(req);
        if (!username || !password) return serveJSON(res, { error: 'Логин и пароль обязательны' }, 400);
        if (username.length < 3) return serveJSON(res, { error: 'Логин минимум 3 символа' }, 400);
        if (password.length < 4) return serveJSON(res, { error: 'Пароль минимум 4 символа' }, 400);
        if (q1('SELECT id FROM users WHERE username=?', [username])) return serveJSON(res, { error: 'Пользователь существует' }, 400);
        const uid = Date.now().toString();
        run('INSERT INTO users (id,username,password,bio,avatarUrl,createdAt) VALUES (?,?,?,?,?,?)', [uid, username, hashPassword(password), '', null, new Date().toISOString()]);
        const token = crypto.randomBytes(32).toString('hex');
        run('INSERT OR REPLACE INTO sessions (token,userId,createdAt) VALUES (?,?,?)', [token, uid, new Date().toISOString()]);
        return serveJSON(res, { success: true, token, user: { id: uid, username } });
    }
    if (url === '/api/login' && m === 'POST') {
        const { username, password } = await readBody(req);
        const user = q1('SELECT * FROM users WHERE username=?', [username]);
        if (!user || user.password !== hashPassword(password)) return serveJSON(res, { error: 'Неверный логин или пароль' }, 401);
        const token = crypto.randomBytes(32).toString('hex');
        run('INSERT OR REPLACE INTO sessions (token,userId,createdAt) VALUES (?,?,?)', [token, user.id, new Date().toISOString()]);
        return serveJSON(res, { success: true, token, user: { id: user.id, username: user.username } });
    }
    if (url === '/api/me' && m === 'GET') {
        if (!u) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const today = new Date().toISOString().split('T')[0];
        const c = q1('SELECT COUNT(*) as count FROM posts WHERE userId=? AND date=?', [u.id, today]);
        return serveJSON(res, { user: { id: u.id, username: u.username, bio: u.bio || '', avatarUrl: u.avatarUrl, createdAt: u.createdAt }, canPost: c.count === 0 });
    }
    if (url.match(/^\/api\/user\/[^/]+$/) && m === 'GET') {
        const uid = url.split('/')[3];
        const user = q1('SELECT * FROM users WHERE id=?', [uid]);
        if (!user) return serveJSON(res, { error: 'Не найден' }, 404);
        const posts = qa('SELECT date FROM posts WHERE userId=? ORDER BY date DESC', [uid]);
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
        return serveJSON(res, { id: user.id, username: user.username, bio: user.bio || '', avatarUrl: user.avatarUrl, createdAt: user.createdAt, totalPosts: posts.length, streak });
    }
    if (url.match(/^\/api\/user\/[^/]+\/posts$/) && m === 'GET') {
        const uid = url.split('/')[3];
        const user = q1('SELECT * FROM users WHERE id=?', [uid]);
        if (!user) return serveJSON(res, { error: 'Не найден' }, 404);
        return serveJSON(res, qa('SELECT * FROM posts WHERE userId=? ORDER BY time DESC', [uid]).map(p => ({ ...p, author: user.username, authorAvatar: user.avatarUrl })));
    }
    if (url === '/api/post' && m === 'POST') {
        if (!u) return serveJSON(res, { error: 'Войдите' }, 401);
        const today = new Date().toISOString().split('T')[0];
        if (q1('SELECT COUNT(*) as count FROM posts WHERE userId=? AND date=?', [u.id, today]).count > 0) return serveJSON(res, { error: 'Уже публиковали сегодня' }, 400);
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
        run('INSERT INTO posts (id,userId,content,imageUrl,date,time) VALUES (?,?,?,?,?,?)', [pid, u.id, content, img, today, new Date().toISOString()]);
        return serveJSON(res, { success: true, post: { id: pid, content, imageUrl: img, author: u.username } });
    }
    if (url === '/api/posts' && m === 'GET') {
        const page = parseInt((new URL(req.url, 'http://localhost').searchParams.get('page') || '1'));
        const limit = 20, offset = (page - 1) * limit;
        return serveJSON(res, qa('SELECT posts.*, users.username as author, users.avatarUrl as authorAvatar FROM posts JOIN users ON posts.userId=users.id ORDER BY posts.time DESC LIMIT ? OFFSET ?', [limit, offset]));
    }
    if (url.match(/^\/api\/post\/[^/]+$/) && m === 'DELETE') {
        if (!u) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const pid = url.split('/')[3];
        const post = q1('SELECT * FROM posts WHERE id=?', [pid]);
        if (!post) return serveJSON(res, { error: 'Не найден' }, 404);
        if (post.userId !== u.id) return serveJSON(res, { error: 'Не ваш пост' }, 403);
        if (post.imageUrl) { const fp = path.join(__dirname, 'public', post.imageUrl); if (fs.existsSync(fp)) fs.unlinkSync(fp); }
        run('DELETE FROM likes WHERE postId=?', [pid]); run('DELETE FROM posts WHERE id=?', [pid]);
        return serveJSON(res, { success: true });
    }
    if (url === '/api/like' && m === 'POST') {
        if (!u) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const { postId } = await readBody(req);
        const ex = q1('SELECT * FROM likes WHERE userId=? AND postId=?', [u.id, postId]);
        if (ex) run('DELETE FROM likes WHERE userId=? AND postId=?', [u.id, postId]);
        else run('INSERT INTO likes (userId,postId,time) VALUES (?,?,?)', [u.id, postId, new Date().toISOString()]);
        return serveJSON(res, { liked: !ex, count: q1('SELECT COUNT(*) as count FROM likes WHERE postId=?', [postId]).count });
    }
    if (url === '/api/likes' && m === 'POST') {
        const { postIds } = await readBody(req);
        if (!postIds || !postIds.length) return serveJSON(res, {});
        const my = u ? qa('SELECT postId FROM likes WHERE userId=?', [u.id]).map(r => r.postId) : [];
        const r = {};
        postIds.forEach(pid => r[pid] = { count: q1('SELECT COUNT(*) as count FROM likes WHERE postId=?', [pid]).count, liked: my.includes(pid) });
        return serveJSON(res, r);
    }
    if (url === '/api/settings' && m === 'GET') {
        if (!u) return serveJSON(res, { error: 'Не авторизован' }, 401);
        return serveJSON(res, { username: u.username, bio: u.bio || '', avatarUrl: u.avatarUrl });
    }
    if (url === '/api/settings' && m === 'POST') {
        if (!u) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const ct = req.headers['content-type'] || '';
        if (ct.includes('multipart/form-data')) {
            const { files } = await parseFormData(req);
            if (files.avatar && files.avatar[0]) {
                const f = files.avatar[0];
                const fn = 'avatar-' + u.id + path.extname(f.originalFilename || '.jpg');
                if (u.avatarUrl) { const op = path.join(__dirname, 'public', u.avatarUrl); if (fs.existsSync(op)) fs.unlinkSync(op); }
                fs.renameSync(f.filepath, path.join(UPLOADS_DIR, fn));
                const av = '/uploads/' + fn;
                run('UPDATE users SET avatarUrl=? WHERE id=?', [av, u.id]);
                return serveJSON(res, { success: true, avatarUrl: av });
            }
            return serveJSON(res, { success: true });
        }
        const { username, password, bio } = await readBody(req);
        const nu = username !== undefined ? username.trim() : u.username;
        const np = password && password.trim() ? hashPassword(password.trim()) : u.password;
        const nb = bio !== undefined ? (bio || '').substring(0, 200) : (u.bio || '');
        if (nu.length < 3) return serveJSON(res, { error: 'Имя от 3 символов' }, 400);
        if (password && password.trim() && password.trim().length < 4) return serveJSON(res, { error: 'Пароль от 4 символов' }, 400);
        run('UPDATE users SET username=?, password=?, bio=? WHERE id=?', [nu, np, nb, u.id]);
        return serveJSON(res, { success: true, user: { id: u.id, username: nu, bio: nb, avatarUrl: u.avatarUrl } });
    }
    if (url === '/api/dialogs' && m === 'GET') {
        if (!u) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const partners = qa('SELECT DISTINCT CASE WHEN fromUserId=? THEN toUserId ELSE fromUserId END as partnerId FROM messages WHERE fromUserId=? OR toUserId=?', [u.id, u.id, u.id]);
        const dialogs = [];
        for (const p of partners) {
            const partner = q1('SELECT * FROM users WHERE id=?', [String(p.partnerId)]);
            if (!partner) continue;
            const lm = q1('SELECT * FROM messages WHERE (fromUserId=? AND toUserId=?) OR (fromUserId=? AND toUserId=?) ORDER BY time DESC LIMIT 1', [u.id, partner.id, partner.id, u.id]);
            const unread = q1('SELECT COUNT(*) as count FROM messages WHERE toUserId=? AND fromUserId=? AND read=0', [u.id, partner.id]).count;
            dialogs.push({ userId: String(partner.id), username: partner.username, avatarUrl: partner.avatarUrl, lastMessage: lm ? lastMsgText(lm.text) : '', lastTime: lm ? lm.time : '', unread });
        }
        dialogs.sort((a, b) => b.lastTime.localeCompare(a.lastTime));
        return serveJSON(res, dialogs);
    }
    if (url.startsWith('/api/messages/') && !url.includes('/photo') && m === 'GET') {
        if (!u) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const partnerId = url.split('/')[3];
        const params = new URL(req.url, 'http://localhost').searchParams;
        const before = params.get('before');
        const limit = 30;
        run('UPDATE messages SET read=1 WHERE fromUserId=? AND toUserId=? AND read=0', [partnerId, u.id]);
        let sql = 'SELECT messages.*, u1.username as fromUsername, u2.username as toUsername FROM messages JOIN users u1 ON messages.fromUserId=u1.id JOIN users u2 ON messages.toUserId=u2.id WHERE ((fromUserId=? AND toUserId=?) OR (fromUserId=? AND toUserId=?))';
        const sp = [u.id, partnerId, partnerId, u.id];
        if (before) { sql += ' AND messages.time < ?'; sp.push(before); }
        sql += ' ORDER BY messages.time DESC LIMIT ?'; sp.push(limit);
        const msgs = qa(sql, sp).reverse();
        const fixed = msgs.map(m => { const p = parseMsg(m.text); return { id: String(m.id), from: String(m.fromUserId), to: String(m.toUserId), fromUserId: String(m.fromUserId), toUserId: String(m.toUserId), text: p.text, imageUrl: p.imageUrl, time: m.time, read: m.read, fromUsername: m.fromUsername, toUsername: m.toUsername }; });
        return serveJSON(res, { messages: fixed, hasMore: msgs.length === limit });
    }
    if (url === '/api/messages/photo' && m === 'POST') {
        if (!u) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const { fields, files } = await parseFormData(req);
        const to = fields.to;
        if (!to) return serveJSON(res, { error: 'Получатель обязателен' }, 400);
        if (String(to) === String(u.id)) return serveJSON(res, { error: 'Нельзя себе' }, 400);
        let img = null;
        if (files.image && files.image[0]) {
            const f = files.image[0];
            const fn = 'chat-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + path.extname(f.originalFilename || '.jpg');
            fs.renameSync(f.filepath, path.join(UPLOADS_DIR, fn));
            img = '/uploads/' + fn;
        }
        const mid = Date.now().toString();
        run('INSERT INTO messages (id,fromUserId,toUserId,text,time,read) VALUES (?,?,?,?,?,0)', [mid, u.id, String(to), JSON.stringify({ text: (fields.text || '').trim(), imageUrl: img }), new Date().toISOString()]);
        return serveJSON(res, { success: true, message: { id: mid, from: String(u.id), to: String(to), text: fields.text || '', imageUrl: img, fromUsername: u.username } });
    }
    if (url === '/api/messages' && m === 'POST') {
        if (!u) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const { to, text } = await readBody(req);
        if (!to || !text || !text.trim()) return serveJSON(res, { error: 'Текст обязателен' }, 400);
        if (String(to) === String(u.id)) return serveJSON(res, { error: 'Нельзя себе' }, 400);
        const mid = Date.now().toString();
        run('INSERT INTO messages (id,fromUserId,toUserId,text,time,read) VALUES (?,?,?,?,?,0)', [mid, u.id, String(to), text.trim(), new Date().toISOString()]);
        return serveJSON(res, { success: true, message: { id: mid, from: String(u.id), to: String(to), text: text.trim(), fromUsername: u.username } });
    }
    if (url.startsWith('/api/users/search') && m === 'GET') {
        if (!u) return serveJSON(res, { error: 'Не авторизован' }, 401);
        const q = (new URL(req.url, 'http://localhost').searchParams.get('q') || '').trim();
        if (!q) return serveJSON(res, []);
        return serveJSON(res, qa('SELECT id, username FROM users WHERE username LIKE ? AND id!=? LIMIT 10', ['%'+q+'%', u.id]).map(x => ({ id: String(x.id), username: x.username })));
    }
    if (url === '/api/unread' && m === 'GET') {
        if (!u) return serveJSON(res, { error: 'Не авторизован' }, 401);
        return serveJSON(res, { count: q1('SELECT COUNT(*) as count FROM messages WHERE toUserId=? AND read=0', [u.id]).count });
    }

    if (url === '/' || url === '/index.html') return serveFile(res, 'public/index.html', 'text/html; charset=utf-8');
    if (url === '/css/style.css') return serveFile(res, 'public/css/style.css', 'text/css; charset=utf-8');
    if (url === '/js/app.js') return serveFile(res, 'public/js/app.js', 'application/javascript; charset=utf-8');

    res.writeHead(404); res.end('Not found');
});

initDb().then(() => server.listen(process.env.PORT || 3000, () => console.log('Сервер запущен')));
setInterval(() => STATIC_CACHE.clear(), 600000);