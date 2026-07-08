let token = localStorage.getItem('token') || '';
let currentUser = null;
let currentChatPartner = null;
let unreadInterval = null;
let canPostToday = true;
let selectedPhoto = null;
let chatPhoto = null;
let lastMessagesHash = '';
let messagesHasMore = true;
let messagesLoading = false;
let feedPage = 1;
let feedHasMore = true;
let feedLoading = false;
let feedObserver = null;

const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];

const authBlock = $('#authBlock');
const appBlock = $('#appBlock');
const msgBadge = $('#msgBadge');
const feedPageEl = $('#feedPage');
const profilePage = $('#profilePage');
const messagesPage = $('#messagesPage');
const settingsPage = $('#settingsPage');
const sidebarBtns = $$('.sidebar-btn');
const postModal = $('#postModal');
const postTextarea = $('#postTextarea');
const publishBtn = $('#publishBtn');
const postLimitWarning = $('#postLimitWarning');
const feedContainer = $('#feedContainer');
const messagesLayout = $('#messagesLayout');
const dialogsSidebar = $('#dialogsSidebar');
const dialogsList = $('#dialogsList');
const chatMessages = $('#chatMessages');
const chatPartnerText = $('#chatPartnerText');
const messageInput = $('#messageInput');
const sendMessageBtn = $('#sendMessageBtn');
const searchResults = $('#searchResults');
const themeToggle = $('#themeToggle');

function applyTheme(dark) {
    document.documentElement.toggleAttribute('data-theme', dark);
    if (themeToggle) themeToggle.checked = dark;
}
const savedTheme = localStorage.getItem('theme');
applyTheme(savedTheme === 'dark' || (!savedTheme && matchMedia('(prefers-color-scheme:dark)').matches));
themeToggle?.addEventListener('change', () => {
    const d = themeToggle.checked;
    applyTheme(d);
    localStorage.setItem('theme', d ? 'dark' : 'light');
});

async function api(url, method = 'GET', body = null, isFormData = false) {
    const headers = {};
    if (!isFormData && body) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const opts = { method, headers };
    if (body) opts.body = isFormData ? body : JSON.stringify(body);
    const r = await fetch(url, opts);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Ошибка');
    return d;
}

$$('.tab-btn').forEach(b => b.addEventListener('click', () => {
    $$('.tab-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    $('#loginForm').classList.toggle('hidden', b.dataset.tab !== 'login');
    $('#registerForm').classList.toggle('hidden', b.dataset.tab !== 'register');
}));

$('#registerFormEl').addEventListener('submit', async e => {
    e.preventDefault();
    try {
        const d = await api('/api/register', 'POST', { username: $('#regUsername').value.trim(), password: $('#regPassword').value });
        token = d.token; currentUser = d.user; currentUser.id = String(currentUser.id);
        localStorage.setItem('token', token);
        enterApp();
    } catch (err) { $('#registerError').textContent = err.message; }
});

$('#loginFormEl').addEventListener('submit', async e => {
    e.preventDefault();
    try {
        const d = await api('/api/login', 'POST', { username: $('#loginUsername').value.trim(), password: $('#loginPassword').value });
        token = d.token; currentUser = d.user; currentUser.id = String(currentUser.id);
        localStorage.setItem('token', token);
        enterApp();
    } catch (err) { $('#loginError').textContent = err.message; }
});

function logout() {
    token = ''; currentUser = null;
    localStorage.removeItem('token');
    clearInterval(unreadInterval);
    authBlock.classList.remove('hidden');
    appBlock.classList.add('hidden');
}
$('#logoutBtn').addEventListener('click', logout);
$('#logoutBtnMobile').addEventListener('click', logout);

sidebarBtns.forEach(b => b.addEventListener('click', () => {
    sidebarBtns.forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    [feedPageEl, profilePage, messagesPage, settingsPage].forEach(p => p.classList.add('hidden'));
    const pg = b.dataset.page;
    if (pg === 'feed') feedPageEl.classList.remove('hidden');
    else if (pg === 'messages') { messagesPage.classList.remove('hidden'); loadDialogs(); }
    else if (pg === 'settings') { settingsPage.classList.remove('hidden'); loadSettings(); }
    dialogsSidebar.classList.remove('chat-open');
    messagesLayout.classList.remove('mobile-view');
}));

$('#openPostModal').addEventListener('click', () => {
    postModal.classList.remove('hidden');
    if (canPostToday) { postTextarea.focus(); postLimitWarning.classList.add('hidden'); publishBtn.disabled = false; }
    else { postLimitWarning.classList.remove('hidden'); publishBtn.disabled = true; }
});
$('#closeModal').addEventListener('click', closeModalFn);
postModal.addEventListener('click', e => { if (e.target === postModal) closeModalFn(); });
function closeModalFn() { postModal.classList.add('hidden'); postTextarea.value = ''; clearPostPhoto(); }
function clearPostPhoto() { selectedPhoto = null; $('#photoInput').value = ''; $('#photoPreview').classList.add('hidden'); $('#photoLabel').classList.remove('has-photo'); }

$('#photoInput').addEventListener('change', () => {
    const f = $('#photoInput').files[0];
    if (!f) return;
    selectedPhoto = f;
    const r = new FileReader();
    r.onload = e => { $('#photoPreviewImg').src = e.target.result; $('#photoPreview').classList.remove('hidden'); $('#photoLabel').classList.add('has-photo'); };
    r.readAsDataURL(f);
});
$('#removePhoto').addEventListener('click', clearPostPhoto);

publishBtn.addEventListener('click', async () => {
    const c = postTextarea.value.trim();
    if (!c) return;
    publishBtn.disabled = true;
    try {
        const fd = new FormData(); fd.append('content', c);
        if (selectedPhoto) fd.append('image', selectedPhoto);
        await api('/api/post', 'POST', fd, true);
        postTextarea.value = ''; postModal.classList.add('hidden'); clearPostPhoto();
        canPostToday = false; updateCreatePostUI();
        feedPage = 1; feedHasMore = true; loadFeed();
    } catch (err) { alert(err.message); publishBtn.disabled = false; }
});

function updateCreatePostUI() {
    const i = $('#openPostModal');
    if (canPostToday) { i.textContent = 'Что у вас нового?'; i.style.color = ''; }
    else { i.textContent = 'Вы уже опубликовали пост сегодня'; i.style.color = '#999'; }
}

async function enterApp() {
    try {
        const d = await api('/api/me');
        currentUser = d.user; currentUser.id = String(currentUser.id); canPostToday = d.canPost;
        authBlock.classList.add('hidden'); appBlock.classList.remove('hidden');
        updateSidebar(); updateCreatePostUI(); loadFeed(); updateUnreadBadge();
        unreadInterval = setInterval(updateUnreadBadge, 5000);
    } catch (err) { logout(); }
}

function updateSidebar() {
    const a = currentUser.avatarUrl ? `<img src="${currentUser.avatarUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : currentUser.username.charAt(0).toUpperCase();
    $('#sidebarAvatar').innerHTML = a;
    $('#createPostAvatar').innerHTML = a;
    $('#sidebarUsername').textContent = currentUser.username;
}

async function loadFeed(append = false) {
    if (feedLoading) return;
    feedLoading = true;
    if (!append) feedContainer.innerHTML = '<div class="skeleton skeleton-card"></div>'.repeat(3);
    try {
        const posts = await api(`/api/posts?page=${feedPage}`);
        if (!append) {
            feedContainer.innerHTML = '<div class="feed-title">Новости</div>';
            if (!posts.length) { feedContainer.innerHTML = '<div class="empty-feed"><div class="empty-icon"><svg viewBox="0 0 80 80" width="64" height="64"><rect x="12" y="16" width="56" height="48" rx="8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><line x1="24" y1="32" x2="56" y2="32" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></div><h3>Лента пуста</h3><p>Станьте первым!</p></div>'; feedLoading = false; return; }
        }
        if (!posts.length) { feedHasMore = false; feedLoading = false; return; }
        const ids = posts.map(p => p.id);
        const ld = await api('/api/likes', 'POST', { postIds: ids });
        posts.forEach((post, i) => {
            const div = document.createElement('div'); div.className = 'post-card';
            div.style.animationDelay = (i * 0.03) + 's';
            const li = ld[post.id] || { count: 0, liked: false };
            const av = post.authorAvatar ? `<img src="${post.authorAvatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" loading="lazy">` : post.author.charAt(0).toUpperCase();
            const del = (currentUser && String(post.userId) === String(currentUser.id)) ? `<button class="post-delete-btn"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0v14a1 1 0 01-1 1H6a1 1 0 01-1-1V6h14M10 11v6m4-6v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : '';
            const ts = new Date(post.time).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
            div.innerHTML = `<div class="post-header"><div class="post-avatar" data-userid="${post.userId}">${av}</div><div class="post-author-info"><div class="post-author" data-userid="${post.userId}">${esc(post.author)}</div><div class="post-time">${ts}</div></div><div class="post-header-right">${del}</div></div><div class="post-body"><div class="post-text">${esc(post.content)}</div>${post.imageUrl ? `<img src="${post.imageUrl}" class="post-image" alt="Фото" loading="lazy">` : ''}</div><div class="post-footer"><button class="like-btn ${li.liked ? 'liked' : ''}"><span class="like-icon">${li.liked ? '❤️' : '🤍'}</span><span class="like-count">${li.count > 0 ? li.count : ''}</span></button></div>`;
            div.querySelectorAll('[data-userid]').forEach(el => el.addEventListener('click', e => { if (!e.target.closest('.like-btn') && !e.target.closest('.post-delete-btn')) viewProfile(post.userId); }));
            div.querySelector('.like-btn').addEventListener('click', async function() {
                try {
                    const r = await api('/api/like', 'POST', { postId: post.id });
                    const ic = this.querySelector('.like-icon'); const ct = this.querySelector('.like-count');
                    if (r.liked) { this.classList.add('liked', 'just-liked'); ic.textContent = '❤️'; setTimeout(() => this.classList.remove('just-liked'), 400); }
                    else { this.classList.remove('liked'); ic.textContent = '🤍'; }
                    ct.textContent = r.count > 0 ? r.count : '';
                } catch (err) {}
            });
            const db = div.querySelector('.post-delete-btn');
            if (db) db.addEventListener('click', async () => { if (confirm('Удалить?')) { try { await api('/api/post/' + post.id, 'DELETE'); feedPage = 1; feedHasMore = true; loadFeed(); } catch (err) { alert(err.message); } } });
            feedContainer.appendChild(div);
        });
        feedPage++;
        if (posts.length < 20) feedHasMore = false;
        setupFeedObserver();
    } catch (err) { if (!append) feedContainer.innerHTML = '<div class="empty-feed"><h3>Ошибка</h3></div>'; }
    feedLoading = false;
}

function setupFeedObserver() {
    if (feedObserver) feedObserver.disconnect();
    const sent = document.createElement('div'); sent.style.height = '1px';
    feedContainer.appendChild(sent);
    feedObserver = new IntersectionObserver(e => { if (e[0].isIntersecting && feedHasMore && !feedLoading) loadFeed(true); }, { rootMargin: '200px' });
    feedObserver.observe(sent);
}

async function viewProfile(uid) {
    sidebarBtns.forEach(b => b.classList.remove('active'));
    [feedPageEl, messagesPage, settingsPage].forEach(p => p.classList.add('hidden'));
    profilePage.classList.remove('hidden');
    profilePage.innerHTML = '<div class="skeleton" style="height:200px;border-radius:16px;margin-bottom:20px;"></div>';
    try {
        const u = await api('/api/user/' + uid);
        const jd = new Date(u.createdAt).toLocaleDateString('ru-RU', { year: 'numeric', month: 'long', day: 'numeric' });
        const sn = u.username.replace(/'/g, "\\'");
        const mb = String(uid) !== String(currentUser.id) ? `<button class="btn-msg" onclick="msgFromProfile('${uid}','${sn}')">Написать</button>` : '';
        const av = u.avatarUrl ? `<div class="profile-avatar-wrapper"><img src="${u.avatarUrl}" alt="Аватар" loading="lazy"></div>` : `<div class="profile-avatar-placeholder">${u.username.charAt(0).toUpperCase()}</div>`;
        profilePage.innerHTML = `<div class="profile-card">${av}<div class="profile-name">${esc(u.username)}</div>${u.bio ? `<div class="profile-bio">${esc(u.bio)}</div>` : ''}<div class="profile-date">На сайте с ${jd}</div><div class="profile-stats"><div><div class="stat-num">${u.totalPosts}</div><div class="stat-label">постов</div></div><div><div class="stat-num">${u.streak}🔥</div><div class="stat-label">дней подряд</div></div></div><div class="profile-btns">${mb}<button class="btn-back-profile" onclick="goToFeed()">← Назад</button></div></div>`;
        const posts = await api('/api/user/' + uid + '/posts');
        const pc = document.createElement('div'); pc.className = 'profile-posts';
        if (!posts.length) pc.innerHTML = '<div class="empty-feed"><h3>Нет постов</h3></div>';
        else {
            const ids = posts.map(p => p.id); const ld = await api('/api/likes', 'POST', { postIds: ids });
            posts.forEach(post => {
                const div = document.createElement('div'); div.className = 'post-card';
                const li = ld[post.id] || { count: 0, liked: false };
                const del = (currentUser && String(post.userId) === String(currentUser.id)) ? `<button class="post-delete-btn"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0v14a1 1 0 01-1 1H6a1 1 0 01-1-1V6h14M10 11v6m4-6v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : '';
                const ts = new Date(post.time).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
                div.innerHTML = `<div class="post-body"><div class="post-text">${esc(post.content)}</div>${post.imageUrl ? `<img src="${post.imageUrl}" class="post-image" alt="Фото" loading="lazy">` : ''}<div class="post-time">${ts}</div></div><div class="post-footer" style="display:flex;align-items:center;justify-content:space-between;"><button class="like-btn ${li.liked ? 'liked' : ''}"><span class="like-icon">${li.liked ? '❤️' : '🤍'}</span><span class="like-count">${li.count > 0 ? li.count : ''}</span></button>${del}</div>`;
                div.querySelector('.like-btn').addEventListener('click', async function() {
                    try { const r = await api('/api/like', 'POST', { postId: post.id }); const ic = this.querySelector('.like-icon'); const ct = this.querySelector('.like-count'); if (r.liked) { this.classList.add('liked', 'just-liked'); ic.textContent = '❤️'; setTimeout(() => this.classList.remove('just-liked'), 400); } else { this.classList.remove('liked'); ic.textContent = '🤍'; } ct.textContent = r.count > 0 ? r.count : ''; } catch (err) {}
                });
                const db = div.querySelector('.post-delete-btn');
                if (db) db.addEventListener('click', async () => { if (confirm('Удалить?')) { try { await api('/api/post/' + post.id, 'DELETE'); viewProfile(uid); } catch (err) { alert(err.message); } } });
                pc.appendChild(div);
            });
        }
        profilePage.appendChild(pc);
    } catch (err) { profilePage.innerHTML = '<div class="empty-feed"><h3>Пользователь не найден</h3></div>'; }
}

function msgFromProfile(uid, un) {
    sidebarBtns.forEach(b => b.classList.remove('active'));
    $('[data-page="messages"]').classList.add('active');
    [feedPageEl, profilePage, settingsPage].forEach(p => p.classList.add('hidden'));
    messagesPage.classList.remove('hidden');
    openChat(uid, un); loadDialogs();
    if (innerWidth <= 768) { dialogsSidebar.classList.add('chat-open'); messagesLayout.classList.add('mobile-view'); }
}

function goToFeed() {
    sidebarBtns.forEach(b => b.classList.remove('active'));
    $('[data-page="feed"]').classList.add('active');
    [profilePage, messagesPage, settingsPage].forEach(p => p.classList.add('hidden'));
    feedPageEl.classList.remove('hidden');
    dialogsSidebar.classList.remove('chat-open');
    messagesLayout.classList.remove('mobile-view');
}

async function updateUnreadBadge() {
    try { const d = await api('/api/unread'); msgBadge.classList.toggle('hidden', !d.count); if (d.count) msgBadge.textContent = d.count; } catch (err) {}
}

async function loadDialogs() {
    try {
        const dialogs = await api('/api/dialogs');
        dialogsList.innerHTML = dialogs.length ? '' : '<div class="no-dialogs">Нет диалогов</div>';
        dialogs.forEach(d => {
            const div = document.createElement('div'); div.className = 'dialog-item';
            if (String(currentChatPartner) === String(d.userId)) div.classList.add('active');
            const t = d.lastTime ? new Date(d.lastTime).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
            div.innerHTML = `<div class="dialog-avatar">${d.avatarUrl ? `<img src="${d.avatarUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" loading="lazy">` : d.username.charAt(0).toUpperCase()}</div><div class="dialog-info"><div class="dialog-name">${esc(d.username)}</div><div class="dialog-last">${esc((d.lastMessage || '').substring(0, 30))}</div></div><div class="dialog-meta"><div class="dialog-time">${t}</div>${d.unread > 0 ? `<div class="unread-badge">${d.unread}</div>` : ''}</div>`;
            div.addEventListener('click', () => openChat(d.userId, d.username, d.avatarUrl));
            dialogsList.appendChild(div);
        });
    } catch (err) {}
}

$('#searchUserInput').addEventListener('input', function() {
    clearTimeout(this._t);
    const q = this.value.trim();
    if (!q) { searchResults.classList.add('hidden'); return; }
    this._t = setTimeout(async () => {
        try {
            const users = await api('/api/users/search?q=' + encodeURIComponent(q));
            searchResults.classList.remove('hidden');
            searchResults.innerHTML = users.length ? '' : '<div class="search-result-item" style="color:var(--text-secondary);">Никого нет</div>';
            users.forEach(u => {
                const div = document.createElement('div'); div.className = 'search-result-item'; div.textContent = u.username;
                div.addEventListener('click', () => { openChat(u.id, u.username, null); this.value = ''; searchResults.classList.add('hidden'); });
                searchResults.appendChild(div);
            });
        } catch (err) {}
    }, 300);
});

function openChat(uid, un, avUrl) {
    currentChatPartner = String(uid); lastMessagesHash = ''; messagesHasMore = true;
    const av = avUrl ? `<img src="${avUrl}" class="chat-partner-avatar-img" alt="" loading="lazy">` : `<div class="chat-partner-avatar-placeholder">${un.charAt(0).toUpperCase()}</div>`;
    chatPartnerText.innerHTML = `<span class="chat-partner-info" data-userid="${uid}" style="display:flex;align-items:center;gap:10px;">${av}<span>${esc(un)}</span></span>`;
    chatPartnerText.querySelector('.chat-partner-info')?.addEventListener('click', e => { e.stopPropagation(); viewProfile(uid); });
    messageInput.disabled = false;
    loadMessages(); loadDialogs();
    if (innerWidth <= 768) { dialogsSidebar.classList.add('chat-open'); messagesLayout.classList.add('mobile-view'); }
}

$('#chatBackBtn').addEventListener('click', () => {
    dialogsSidebar.classList.remove('chat-open'); messagesLayout.classList.remove('mobile-view');
    currentChatPartner = null; lastMessagesHash = '';
    chatPartnerText.textContent = 'Выберите диалог';
    messageInput.disabled = true; sendMessageBtn.disabled = true;
    chatMessages.innerHTML = '<div class="chat-empty">Выберите диалог или найдите пользователя</div>';
});

messageInput.addEventListener('input', () => {
    sendMessageBtn.disabled = !(messageInput.value.trim() || chatPhoto);
});

async function loadMessages(before = null, prepend = false) {
    if (!currentChatPartner) { chatMessages.innerHTML = '<div class="chat-empty">Выберите диалог</div>'; return; }
    if (messagesLoading) return;
    messagesLoading = true;
    let url = '/api/messages/' + currentChatPartner;
    if (before) url += '?before=' + encodeURIComponent(before);
    try {
        const data = await api(url);
        const msgs = data.messages;
        messagesHasMore = data.hasMore;
        if (!prepend) {
            const hash = JSON.stringify(msgs);
            if (hash === lastMessagesHash) { messagesLoading = false; return; }
            lastMessagesHash = hash;
            chatMessages.innerHTML = msgs.length ? '' : '<div class="chat-empty">Напишите первым!</div>';
        }
        const frag = document.createDocumentFragment();
        msgs.forEach(m => {
            const div = document.createElement('div');
            div.className = 'message ' + (String(m.from) === String(currentUser.id) ? 'message-sent' : 'message-received');
            const t = new Date(m.time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
            div.innerHTML = (m.text ? esc(m.text) : '') + (m.imageUrl ? `<img src="${m.imageUrl}" class="message-image" alt="Фото" loading="lazy">` : '') + `<div class="message-time">${t}</div>`;
            frag.appendChild(div);
        });
        if (prepend) {
            const oldH = chatMessages.scrollHeight;
            chatMessages.insertBefore(frag, chatMessages.firstChild);
            chatMessages.scrollTop = chatMessages.scrollHeight - oldH;
        } else {
            chatMessages.appendChild(frag);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
        updateUnreadBadge();
    } catch (err) {}
    messagesLoading = false;
}

chatMessages.addEventListener('scroll', () => {
    if (chatMessages.scrollTop < 100 && messagesHasMore && !messagesLoading) {
        const firstMsg = chatMessages.querySelector('.message');
        if (firstMsg) {
            const timeEl = firstMsg.querySelector('.message-time');
            if (timeEl) loadMessages(timeEl.textContent, true);
        }
    }
});

async function sendMsg() {
    const t = messageInput.value.trim();
    if ((!t && !chatPhoto) || !currentChatPartner) return;
    try {
        if (chatPhoto) {
            const fd = new FormData(); fd.append('to', currentChatPartner); fd.append('text', t || ''); fd.append('image', chatPhoto);
            const r = await fetch('/api/messages/photo', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: fd });
            if (!r.ok) throw new Error((await r.json()).error);
        } else {
            await api('/api/messages', 'POST', { to: currentChatPartner, text: t });
        }
        messageInput.value = ''; chatPhoto = null;
        $('#chatPhotoInput').value = ''; $('#chatPhotoPreview').classList.add('hidden');
        lastMessagesHash = ''; loadMessages(); loadDialogs();
    } catch (err) { alert(err.message); }
}

sendMessageBtn.addEventListener('click', sendMsg);
messageInput.addEventListener('keypress', e => { if (e.key === 'Enter') sendMsg(); });

$('#chatAttachBtn').addEventListener('click', () => $('#chatPhotoInput').click());
$('#chatPhotoInput').addEventListener('change', () => {
    const f = $('#chatPhotoInput').files[0];
    if (!f) return;
    chatPhoto = f;
    const r = new FileReader();
    r.onload = e => { $('#chatPhotoPreviewImg').src = e.target.result; $('#chatPhotoPreview').classList.remove('hidden'); sendMessageBtn.disabled = false; };
    r.readAsDataURL(f);
});
$('#chatRemovePhoto').addEventListener('click', () => {
    chatPhoto = null; $('#chatPhotoInput').value = ''; $('#chatPhotoPreview').classList.add('hidden');
    sendMessageBtn.disabled = !messageInput.value.trim();
});

async function loadSettings() {
    try { const d = await api('/api/settings'); $('#settingsUsername').value = d.username; $('#settingsBio').value = d.bio || ''; updateSA(d.avatarUrl, d.username); } catch (err) {}
}
function updateSA(url, name) {
    if (url) $('#settingsAvatarContainer').innerHTML = `<img src="${url}" class="settings-avatar-img" alt="Аватар">`;
    else $('#settingsAvatarContainer').innerHTML = `<div class="settings-avatar-placeholder">${name.charAt(0).toUpperCase()}</div>`;
}
$('#avatarInput').addEventListener('change', async () => {
    const f = $('#avatarInput').files[0]; if (!f) return;
    const fd = new FormData(); fd.append('avatar', f);
    try {
        const r = await fetch('/api/settings', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: fd });
        const d = await r.json(); if (!r.ok) throw new Error(d.error);
        currentUser.avatarUrl = d.avatarUrl; updateSA(d.avatarUrl, currentUser.username); updateSidebar(); showOk('Аватар обновлён!');
    } catch (err) { alert(err.message); }
});
$('#saveProfile').addEventListener('click', async () => {
    const u = $('#settingsUsername').value.trim(); const b = $('#settingsBio').value.trim();
    if (u.length < 3) return alert('Имя от 3 символов');
    try { const d = await api('/api/settings', 'POST', { username: u, bio: b }); currentUser = d.user; currentUser.id = String(currentUser.id); updateSidebar(); showOk('Профиль сохранён!'); } catch (err) { alert(err.message); }
});
$('#savePassword').addEventListener('click', async () => {
    const p = $('#settingsPassword').value.trim();
    if (!p) return alert('Введите пароль');
    if (p.length < 4) return alert('От 4 символов');
    try { await api('/api/settings', 'POST', { password: p }); $('#settingsPassword').value = ''; showOk('Пароль изменён!'); } catch (err) { alert(err.message); }
});
function showOk(m) { const el = $('#settingsSuccess'); el.textContent = '✅ ' + m; el.classList.remove('hidden'); setTimeout(() => el.classList.add('hidden'), 3000); }

setInterval(() => { if (currentChatPartner && !messagesPage.classList.contains('hidden') && chatMessages.scrollTop > chatMessages.scrollHeight - chatMessages.clientHeight - 200) loadMessages(); }, 3000);
setInterval(() => { if (!messagesPage.classList.contains('hidden')) loadDialogs(); }, 5000);

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
if (token) enterApp();