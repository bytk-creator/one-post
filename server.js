const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const formidable = require('formidable');
const initSqlJs = require('sql.js');

const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const CACHE = new Map();

[UPLOADS_DIR, path.join(__dirname, 'public', 'css'), path.join(__dirname, 'public', 'js')].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const DB_PATH = path.join(DATA_DIR, 'database.db');
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml'
};

let db;

function saveDb() {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
}

async function initDb() {
    const SQL = await initSqlJs();
    if (fs.existsSync(DB_PATH)) {
        db = new SQL.Database(fs.readFileSync(DB_PATH));
    } else {
        db = new SQL.Database();
    }
    
    db.run('PRAGMA journal_mode=WAL');
    db.run('PRAGMA synchronous=NORMAL');
    db.run('PRAGMA cache_size=-8000');
    db.run('PRAGMA temp_store=MEMORY');
    
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
        bio TEXT DEFAULT '', avatarUrl TEXT, createdAt TEXT NOT NULL)`);
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
    
    db.run('CREATE INDEX IF NOT EXISTS idx_posts_userId_date ON posts(userId, date)');
    db.run('CREATE INDEX IF NOT EXISTS idx_posts_time ON posts(time DESC)');
    db.run('CREATE INDEX IF NOT EXISTS idx_likes_postId ON likes(postId)');
    db.run('CREATE INDEX IF NOT EXISTS idx_likes_userId ON likes(userId)');
    db.run('CREATE INDEX IF NOT EXISTS idx_messages_users ON messages(fromUserId, toUserId)');
    db.run('CREATE INDEX IF NOT EXISTS idx_messages_time ON messages(time)');
    db.run('CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)');
    
    saveDb();
}

const utils = {
    hashPassword(p) { return crypto.createHash('sha256').update(p).digest('hex'); },
    
    readBody(req) {
        return new Promise((resolve) => {
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });
            req.on('end', () => {
                try { resolve(JSON.parse(body)); } catch (e) { resolve({}); }
            });
        });
    },

    parseFormData(req) {
        return new Promise((resolve) => {
            const form = new formidable.IncomingForm({
                uploadDir: UPLOADS_DIR, keepExtensions: true,
                maxFileSize: 10 * 1024 * 1024
            });
            form.parse(req, (err, fields, files) => {
                if (err) { resolve({ fields: {}, files: {} }); return; }
                const cleanFields = {};
                Object.keys(fields).forEach(key => {
                    cleanFields[key] = Array.isArray(fields[key]) ? fields[key][0] : fields[key];
                });
                resolve({ fields: cleanFields, files });
            });
        });
    },

    getAuth(req) {
        const token = (req.headers['authorization'] || '').replace('Bearer ', '');
        if (!token) return null;
        const session = queryOne('SELECT * FROM sessions WHERE token = ?', [token]);
        if (!session) return null;
        return queryOne('SELECT * FROM users WHERE id = ?', [session.userId]);
    },

    serveJSON(res, data, status = 200) {
        const json = JSON.stringify(data);
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(json);
    },

    serveFile(res, filePath, cache = true) {
        if (cache && CACHE.has(filePath)) {
            const cached = CACHE.get(filePath);
            res.writeHead(200, cached.headers);
            return res.end(cached.data);
        }
        
        const fullPath = path.join(__dirname, filePath);
        const ext = path.extname(fullPath).toLowerCase();
        const mime = MIME[ext] || 'application/octet-stream';
        
        try {
            let data = fs.readFileSync(fullPath);
            const headers = { 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400' };
            
            if (cache) {
                CACHE.set(filePath, { data, headers });
            }
            
            res.writeHead(200, headers);
            res.end(data);
        } catch (err) {
            res.writeHead(404);
            res.end('Not found');
        }
    }
};

function queryOne(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const row = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return row;
}

function queryAll(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
}

function runSql(sql, params = []) {
    db.run(sql, params);
    saveDb();
}

function parseLastMessage(text) {
    if (!text) return '';
    try {
        const parsed = JSON.parse(text);
        return (parsed && parsed.imageUrl) ? '📷 Фото' : (parsed.text || text);
    } catch (e) {
        return text;
    }
}

function parseMessageText(text) {
    try {
        const parsed = JSON.parse(text);
        return { text: parsed.text || '', imageUrl: parsed.imageUrl || null };
    } catch (e) {
        return { text, imageUrl: null };
    }
}

const server = http.createServer(async (req, res) => {
    const url = req.url.split('?')[0];
    const method = req.method;
    const currentUser = utils.getAuth(req);

    if (url.startsWith('/uploads/') && method === 'GET') {
        return utils.serveFile(res, 'public' + url);
    }

    if (url.match(/\.(css|js|html|ico|svg|png|jpg|jpeg|gif|webp)$/)) {
        const filePath = 'public' + (url === '/' ? '/index.html' : url);
        return utils.serveFile(res, filePath);
    }

    // AUTH
    if (url === '/api/register' && method === 'POST') {
        const { username, password } = await utils.readBody(req);
        if (!username || !password) return utils.serveJSON(res, { error: 'Логин и пароль обязательны' }, 400);
        if (username.length < 3) return utils.serveJSON(res, { error: 'Логин минимум 3 символа' }, 400);
        if (password.length < 4) return utils.serveJSON(res, { error: 'Пароль минимум 4 символа' }, 400);
        if (queryOne('SELECT id FROM users WHERE username = ?', [username])) return utils.serveJSON(res, { error: 'Пользователь уже существует' }, 400);
        
        const userId = Date.now().toString();
        runSql('INSERT INTO users (id, username, password, bio, avatarUrl, createdAt) VALUES (?, ?, ?, ?, ?, ?)', 
            [userId, username, utils.hashPassword(password), '', null, new Date().toISOString()]);
        const token = crypto.randomBytes(32).toString('hex');
        runSql('INSERT OR REPLACE INTO sessions (token, userId, createdAt) VALUES (?, ?, ?)', [token, userId, new Date().toISOString()]);
        return utils.serveJSON(res, { success: true, token, user: { id: userId, username } });
    }

    if (url === '/api/login' && method === 'POST') {
        const { username, password } = await utils.readBody(req);
        const user = queryOne('SELECT * FROM users WHERE username = ?', [username]);
        if (!user || user.password !== utils.hashPassword(password)) return utils.serveJSON(res, { error: 'Неверный логин или пароль' }, 401);
        const token = crypto.randomBytes(32).toString('hex');
        runSql('INSERT OR REPLACE INTO sessions (token, userId, createdAt) VALUES (?, ?, ?)', [token, user.id, new Date().toISOString()]);
        return utils.serveJSON(res, { success: true, token, user: { id: user.id, username: user.username } });
    }

    if (url === '/api/me' && method === 'GET') {
        if (!currentUser) return utils.serveJSON(res, { error: 'Не авторизован' }, 401);
        const today = new Date().toISOString().split('T')[0];
        const count = queryOne('SELECT COUNT(*) as count FROM posts WHERE userId = ? AND date = ?', [currentUser.id, today]);
        return utils.serveJSON(res, { user: { ...currentUser, bio: currentUser.bio || '' }, canPost: count.count === 0 });
    }

    // USERS
    if (url.match(/^\/api\/user\/[^/]+$/) && method === 'GET') {
        const userId = url.split('/')[3];
        const user = queryOne('SELECT * FROM users WHERE id = ?', [userId]);
        if (!user) return utils.serveJSON(res, { error: 'Пользователь не найден' }, 404);
        const posts = queryAll('SELECT date FROM posts WHERE userId = ? ORDER BY date DESC', [userId]);
        const dates = [...new Set(posts.map(p => p.date))];
        let streak = 0;
        const today = new Date().toISOString().split('T')[0];
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        if (dates.length > 0 && (dates[0] === today || dates[0] === yesterday)) {
            streak = 1;
            for (let i = 1; i < dates.length; i++) {
                const prev = new Date(dates[i-1]); prev.setDate(prev.getDate() - 1);
                if (dates[i] === prev.toISOString().split('T')[0]) streak++; else break;
            }
        }
        return utils.serveJSON(res, { ...user, bio: user.bio || '', totalPosts: posts.length, streak });
    }

    if (url.match(/^\/api\/user\/[^/]+\/posts$/) && method === 'GET') {
        const userId = url.split('/')[3];
        const user = queryOne('SELECT * FROM users WHERE id = ?', [userId]);
        if (!user) return utils.serveJSON(res, { error: 'Пользователь не найден' }, 404);
        const posts = queryAll('SELECT * FROM posts WHERE userId = ? ORDER BY time DESC', [userId])
            .map(p => ({ ...p, author: user.username, authorAvatar: user.avatarUrl }));
        return utils.serveJSON(res, posts);
    }

    if (url.startsWith('/api/users/search') && method === 'GET') {
        if (!currentUser) return utils.serveJSON(res, { error: 'Не авторизован' }, 401);
        const q = (new URL(req.url, 'http://localhost').searchParams.get('q') || '').trim();
        if (!q) return utils.serveJSON(res, []);
        const users = queryAll('SELECT id, username FROM users WHERE username LIKE ? AND id != ? LIMIT 10', [`%${q}%`, currentUser.id]);
        return utils.serveJSON(res, users.map(u => ({ id: String(u.id), username: u.username })));
    }

    // POSTS
    if (url === '/api/post' && method === 'POST') {
        if (!currentUser) return utils.serveJSON(res, { error: 'Войдите в аккаунт' }, 401);
        const today = new Date().toISOString().split('T')[0];
        if (queryOne('SELECT COUNT(*) as count FROM posts WHERE userId = ? AND date = ?', [currentUser.id, today]).count > 0) 
            return utils.serveJSON(res, { error: 'Вы уже публиковали сегодня' }, 400);
        
        const { fields, files } = await utils.parseFormData(req);
        const content = (fields.content || '').trim();
        if (!content) return utils.serveJSON(res, { error: 'Пост не может быть пустым' }, 400);
        
        let imageUrl = null;
        if (files.image && files.image[0]) {
            const file = files.image[0];
            const ext = path.extname(file.originalFilename || '.jpg');
            const fileName = Date.now() + '-' + crypto.randomBytes(4).toString('hex') + ext;
            fs.renameSync(file.filepath, path.join(UPLOADS_DIR, fileName));
            imageUrl = '/uploads/' + fileName;
        }
        
        const postId = Date.now().toString();
        runSql('INSERT INTO posts (id, userId, content, imageUrl, date, time) VALUES (?, ?, ?, ?, ?, ?)', 
            [postId, currentUser.id, content, imageUrl, today, new Date().toISOString()]);
        return utils.serveJSON(res, { success: true, post: { id: postId, content, imageUrl, author: currentUser.username } });
    }

    if (url === '/api/posts' && method === 'GET') {
        const page = parseInt((new URL(req.url, 'http://localhost').searchParams.get('page') || '1'));
        const limit = 20;
        const offset = (page - 1) * limit;
        const posts = queryAll('SELECT posts.*, users.username as author, users.avatarUrl as authorAvatar FROM posts JOIN users ON posts.userId = users.id ORDER BY posts.time DESC LIMIT ? OFFSET ?', [limit, offset]);
        return utils.serveJSON(res, posts);
    }

    if (url.match(/^\/api\/post\/[^/]+$/) && method === 'DELETE') {
        if (!currentUser) return utils.serveJSON(res, { error: 'Не авторизован' }, 401);
        const postId = url.split('/')[3];
        const post = queryOne('SELECT * FROM posts WHERE id = ?', [postId]);
        if (!post) return utils.serveJSON(res, { error: 'Пост не найден' }, 404);
        if (post.userId !== currentUser.id) return utils.serveJSON(res, { error: 'Это не ваш пост' }, 403);
        if (post.imageUrl) {
            const imgPath = path.join(__dirname, 'public', post.imageUrl);
            if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
        }
        runSql('DELETE FROM likes WHERE postId = ?', [postId]);
        runSql('DELETE FROM posts WHERE id = ?', [postId]);
        return utils.serveJSON(res, { success: true });
    }

    // LIKES
    if (url === '/api/like' && method === 'POST') {
        if (!currentUser) return utils.serveJSON(res, { error: 'Не авторизован' }, 401);
        const { postId } = await utils.readBody(req);
        const existing = queryOne('SELECT * FROM likes WHERE userId = ? AND postId = ?', [currentUser.id, postId]);
        if (existing) runSql('DELETE FROM likes WHERE userId = ? AND postId = ?', [currentUser.id, postId]);
        else runSql('INSERT INTO likes (userId, postId, time) VALUES (?, ?, ?)', [currentUser.id, postId, new Date().toISOString()]);
        const count = queryOne('SELECT COUNT(*) as count FROM likes WHERE postId = ?', [postId]).count;
        return utils.serveJSON(res, { liked: !existing, count });
    }

    if (url === '/api/likes' && method === 'POST') {
        const { postIds } = await utils.readBody(req);
        if (!postIds || !Array.isArray(postIds) || !postIds.length) return utils.serveJSON(res, {});
        const myLikes = currentUser ? queryAll('SELECT postId FROM likes WHERE userId = ?', [currentUser.id]).map(r => r.postId) : [];
        const result = {};
        const placeholders = postIds.map(() => '?').join(',');
        const counts = queryAll(`SELECT postId, COUNT(*) as count FROM likes WHERE postId IN (${placeholders}) GROUP BY postId`, postIds);
        const countMap = {};
        counts.forEach(c => { countMap[c.postId] = c.count; });
        postIds.forEach(pid => { result[pid] = { count: countMap[pid] || 0, liked: myLikes.includes(pid) }; });
        return utils.serveJSON(res, result);
    }

    // MESSAGES
    if (url === '/api/dialogs' && method === 'GET') {
        if (!currentUser) return utils.serveJSON(res, { error: 'Не авторизован' }, 401);
        const partners = queryAll(`SELECT DISTINCT CASE WHEN fromUserId = ? THEN toUserId ELSE fromUserId END as partnerId FROM messages WHERE fromUserId = ? OR toUserId = ?`, [currentUser.id, currentUser.id, currentUser.id]);
        const dialogs = [];
        for (const p of partners) {
            const partner = queryOne('SELECT * FROM users WHERE id = ?', [String(p.partnerId)]);
            if (!partner) continue;
            const lastMsg = queryOne('SELECT * FROM messages WHERE (fromUserId = ? AND toUserId = ?) OR (fromUserId = ? AND toUserId = ?) ORDER BY time DESC LIMIT 1', [currentUser.id, partner.id, partner.id, currentUser.id]);
            const unread = queryOne('SELECT COUNT(*) as count FROM messages WHERE toUserId = ? AND fromUserId = ? AND read = 0', [currentUser.id, partner.id]).count;
            dialogs.push({
                userId: String(partner.id), username: partner.username, avatarUrl: partner.avatarUrl,
                lastMessage: lastMsg ? parseLastMessage(lastMsg.text) : '', lastTime: lastMsg ? lastMsg.time : '', unread
            });
        }
        dialogs.sort((a, b) => b.lastTime.localeCompare(a.lastTime));
        return utils.serveJSON(res, dialogs);
    }

    if (url.startsWith('/api/messages/') && !url.includes('/photo') && method === 'GET') {
        if (!currentUser) return utils.serveJSON(res, { error: 'Не авторизован' }, 401);
        const partnerId = url.split('/')[3];
        runSql('UPDATE messages SET read = 1 WHERE fromUserId = ? AND toUserId = ? AND read = 0', [partnerId, currentUser.id]);
        const messages = queryAll(`SELECT messages.*, u1.username as fromUsername, u2.username as toUsername FROM messages JOIN users u1 ON messages.fromUserId = u1.id JOIN users u2 ON messages.toUserId = u2.id WHERE (fromUserId = ? AND toUserId = ?) OR (fromUserId = ? AND toUserId = ?) ORDER BY time ASC LIMIT 50`, [currentUser.id, partnerId, partnerId, currentUser.id]);
        const fixed = messages.map(m => {
            const parsed = parseMessageText(m.text);
            return {
                id: String(m.id), from: String(m.fromUserId), to: String(m.toUserId),
                fromUserId: String(m.fromUserId), toUserId: String(m.toUserId),
                text: parsed.text, imageUrl: parsed.imageUrl, time: m.time, read: m.read,
                fromUsername: m.fromUsername, toUsername: m.toUsername
            };
        });
        return utils.serveJSON(res, fixed);
    }

    if (url === '/api/messages/photo' && method === 'POST') {
        if (!currentUser) return utils.serveJSON(res, { error: 'Не авторизован' }, 401);
        const { fields, files } = await utils.parseFormData(req);
        const to = fields.to;
        if (!to) return utils.serveJSON(res, { error: 'Получатель обязателен' }, 400);
        if (String(to) === String(currentUser.id)) return utils.serveJSON(res, { error: 'Нельзя себе' }, 400);
        
        let imageUrl = null;
        if (files.image && files.image[0]) {
            const file = files.image[0];
            const ext = path.extname(file.originalFilename || '.jpg');
            const fileName = 'chat-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + ext;
            fs.renameSync(file.filepath, path.join(UPLOADS_DIR, fileName));
            imageUrl = '/uploads/' + fileName;
        }
        
        const msgId = Date.now().toString();
        const storedText = JSON.stringify({ text: (fields.text || '').trim(), imageUrl });
        runSql('INSERT INTO messages (id, fromUserId, toUserId, text, time, read) VALUES (?, ?, ?, ?, ?, 0)', [msgId, currentUser.id, String(to), storedText, new Date().toISOString()]);
        return utils.serveJSON(res, { success: true, message: { id: msgId, from: String(currentUser.id), to: String(to), text: fields.text || '', imageUrl, fromUsername: currentUser.username } });
    }

    if (url === '/api/messages' && method === 'POST') {
        if (!currentUser) return utils.serveJSON(res, { error: 'Не авторизован' }, 401);
        const { to, text } = await utils.readBody(req);
        if (!to || !text || !text.trim()) return utils.serveJSON(res, { error: 'Получатель и текст обязательны' }, 400);
        if (String(to) === String(currentUser.id)) return utils.serveJSON(res, { error: 'Нельзя себе' }, 400);
        const msgId = Date.now().toString();
        runSql('INSERT INTO messages (id, fromUserId, toUserId, text, time, read) VALUES (?, ?, ?, ?, ?, 0)', [msgId, currentUser.id, String(to), text.trim(), new Date().toISOString()]);
        return utils.serveJSON(res, { success: true, message: { id: msgId, from: String(currentUser.id), to: String(to), text: text.trim(), fromUsername: currentUser.username } });
    }

    if (url === '/api/unread' && method === 'GET') {
        if (!currentUser) return utils.serveJSON(res, { error: 'Не авторизован' }, 401);
        const count = queryOne('SELECT COUNT(*) as count FROM messages WHERE toUserId = ? AND read = 0', [currentUser.id]).count;
        return utils.serveJSON(res, { count });
    }

    // SETTINGS
    if (url === '/api/settings' && method === 'GET') {
        if (!currentUser) return utils.serveJSON(res, { error: 'Не авторизован' }, 401);
        return utils.serveJSON(res, { username: currentUser.username, bio: currentUser.bio || '', avatarUrl: currentUser.avatarUrl });
    }

    if (url === '/api/settings' && method === 'POST') {
        if (!currentUser) return utils.serveJSON(res, { error: 'Не авторизован' }, 401);
        const contentType = req.headers['content-type'] || '';
        if (contentType.includes('multipart/form-data')) {
            const { files } = await utils.parseFormData(req);
            if (files.avatar && files.avatar[0]) {
                const file = files.avatar[0];
                const ext = path.extname(file.originalFilename || '.jpg');
                const fileName = 'avatar-' + currentUser.id + ext;
                if (currentUser.avatarUrl) {
                    const oldPath = path.join(__dirname, 'public', currentUser.avatarUrl);
                    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
                }
                fs.renameSync(file.filepath, path.join(UPLOADS_DIR, fileName));
                const avatarUrl = '/uploads/' + fileName;
                runSql('UPDATE users SET avatarUrl = ? WHERE id = ?', [avatarUrl, currentUser.id]);
                return utils.serveJSON(res, { success: true, avatarUrl });
            }
            return utils.serveJSON(res, { success: true });
        }
        const { username, password, bio } = await utils.readBody(req);
        const newUsername = username !== undefined ? username.trim() : currentUser.username;
        const newPassword = password && password.trim() ? utils.hashPassword(password.trim()) : currentUser.password;
        const newBio = bio !== undefined ? (bio || '').substring(0, 200) : (currentUser.bio || '');
        if (newUsername.length < 3) return utils.serveJSON(res, { error: 'Имя минимум 3 символа' }, 400);
        if (password && password.trim() && password.trim().length < 4) return utils.serveJSON(res, { error: 'Пароль минимум 4 символа' }, 400);
        runSql('UPDATE users SET username = ?, password = ?, bio = ? WHERE id = ?', [newUsername, newPassword, newBio, currentUser.id]);
        return utils.serveJSON(res, { success: true, user: { id: currentUser.id, username: newUsername, bio: newBio, avatarUrl: currentUser.avatarUrl } });
    }

    res.writeHead(404);
    res.end('Not found');
});

initDb().then(() => {
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => console.log('Сервер запущен на порту ' + PORT));
});

setInterval(() => { CACHE.clear(); }, 300000);