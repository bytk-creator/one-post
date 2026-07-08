const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

let state = {
    token: localStorage.getItem('token') || '',
    user: null,
    chatPartner: null,
    canPost: true,
    selectedPhoto: null,
    chatPhoto: null,
    lastMessagesHash: '',
    unreadInterval: null,
    feedPage: 1,
    feedHasMore: true,
    feedLoading: false,
    feedObserver: null
};

// DOM refs
const dom = {
    authBlock: $('#authBlock'),
    appBlock: $('#appBlock'),
    loginForm: $('#loginForm'),
    registerForm: $('#registerForm'),
    tabBtns: $$('.tab-btn'),
    logoutBtn: $('#logoutBtn'),
    logoutBtnMobile: $('#logoutBtnMobile'),
    msgBadge: $('#msgBadge'),
    feedPage: $('#feedPage'),
    profilePage: $('#profilePage'),
    messagesPage: $('#messagesPage'),
    settingsPage: $('#settingsPage'),
    sidebarBtns: $$('.sidebar-btn'),
    postModal: $('#postModal'),
    postTextarea: $('#postTextarea'),
    publishBtn: $('#publishBtn'),
    postLimitWarning: $('#postLimitWarning'),
    feedContainer: $('#feedContainer'),
    messagesLayout: $('#messagesLayout'),
    dialogsSidebar: $('#dialogsSidebar'),
    dialogsList: $('#dialogsList'),
    chatMessages: $('#chatMessages'),
    chatPartnerText: $('#chatPartnerText'),
    messageInput: $('#messageInput'),
    sendMessageBtn: $('#sendMessageBtn'),
    themeToggle: $('#themeToggle'),
    get openPostModal() { return $('#openPostModal'); },
    get closeModal() { return $('#closeModal'); },
    get photoInput() { return $('#photoInput'); },
    get photoPreview() { return $('#photoPreview'); },
    get removePhoto() { return $('#removePhoto'); },
    get chatAttachBtn() { return $('#chatAttachBtn'); },
    get chatPhotoInput() { return $('#chatPhotoInput'); },
    get chatPhotoPreview() { return $('#chatPhotoPreview'); },
    get chatRemovePhoto() { return $('#chatRemovePhoto'); }
};

// Theme
function applyTheme(dark) {
    document.documentElement.toggleAttribute('data-theme', dark);
    if (dom.themeToggle) dom.themeToggle.checked = dark;
}
const savedTheme = localStorage.getItem('theme');
applyTheme(savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches));
dom.themeToggle?.addEventListener('change', () => {
    const dark = dom.themeToggle.checked;
    applyTheme(dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
});

// API
async function api(url, method = 'GET', body = null, isFormData = false) {
    const headers = {};
    if (!isFormData && body) headers['Content-Type'] = 'application/json';
    if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
    const opts = { method, headers };
    if (body) opts.body = isFormData ? body : JSON.stringify(body);
    const r = await fetch(url, opts);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Ошибка');
    return d;
}

// Auth
dom.tabBtns.forEach(btn => btn.addEventListener('click', () => {
    dom.tabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    dom.loginForm.classList.toggle('hidden', btn.dataset.tab !== 'login');
    dom.registerForm.classList.toggle('hidden', btn.dataset.tab !== 'register');
}));

$('#registerFormEl').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        const d = await api('/api/register', 'POST', {
            username: $('#regUsername').value.trim(),
            password: $('#regPassword').value
        });
        state.token = d.token; state.user = d.user; state.user.id = String(state.user.id);
        localStorage.setItem('token', state.token);
        enterApp();
    } catch (err) { $('#registerError').textContent = err.message; }
});

$('#loginFormEl').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        const d = await api('/api/login', 'POST', {
            username: $('#loginUsername').value.trim(),
            password: $('#loginPassword').value
        });
        state.token = d.token; state.user = d.user; state.user.id = String(state.user.id);
        localStorage.setItem('token', state.token);
        enterApp();
    } catch (err) { $('#loginError').textContent = err.message; }
});

dom.logoutBtn.addEventListener('click', logout);
dom.logoutBtnMobile.addEventListener('click', logout);

function logout() {
    state.token = ''; state.user = null;
    localStorage.removeItem('token');
    clearInterval(state.unreadInterval);
    dom.authBlock.classList.remove('hidden');
    dom.appBlock.classList.add('hidden');
}

// Navigation
dom.sidebarBtns.forEach(btn => btn.addEventListener('click', () => {
    dom.sidebarBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    [dom.feedPage, dom.profilePage, dom.messagesPage, dom.settingsPage].forEach(p => p.classList.add('hidden'));
    const page = btn.dataset.page;
    if (page === 'feed') dom.feedPage.classList.remove('hidden');
    else if (page === 'messages') { dom.messagesPage.classList.remove('hidden'); loadDialogs(); }
    else if (page === 'settings') { dom.settingsPage.classList.remove('hidden'); loadSettings(); }
    dom.dialogsSidebar.classList.remove('chat-open');
    dom.messagesLayout.classList.remove('mobile-view');
}));

// Modal
dom.openPostModal.addEventListener('click', () => {
    dom.postModal.classList.remove('hidden');
    if (state.canPost) { dom.postTextarea.focus(); dom.postLimitWarning.classList.add('hidden'); dom.publishBtn.disabled = false; }
    else { dom.postLimitWarning.classList.remove('hidden'); dom.publishBtn.disabled = true; }
});
dom.closeModal.addEventListener('click', closeModalFn);
dom.postModal.addEventListener('click', (e) => { if (e.target === dom.postModal) closeModalFn(); });
function closeModalFn() { dom.postModal.classList.add('hidden'); dom.postTextarea.value = ''; clearPostPhoto(); }
function clearPostPhoto() { state.selectedPhoto = null; dom.photoInput.value = ''; dom.photoPreview.classList.add('hidden'); $('#photoLabel').classList.remove('has-photo'); }

dom.photoInput.addEventListener('change', () => {
    const f = dom.photoInput.files[0];
    if (!f) return;
    state.selectedPhoto = f;
    const reader = new FileReader();
    reader.onload = (e) => {
        $('#photoPreviewImg').src = e.target.result;
        dom.photoPreview.classList.remove('hidden');
        $('#photoLabel').classList.add('has-photo');
    };
    reader.readAsDataURL(f);
});
dom.removePhoto.addEventListener('click', clearPostPhoto);

dom.publishBtn.addEventListener('click', async () => {
    const c = dom.postTextarea.value.trim();
    if (!c) return;
    dom.publishBtn.disabled = true;
    try {
        const fd = new FormData();
        fd.append('content', c);
        if (state.selectedPhoto) fd.append('image', state.selectedPhoto);
        const d = await api('/api/post', 'POST', fd, true);
        dom.postTextarea.value = '';
        dom.postModal.classList.add('hidden');
        clearPostPhoto();
        state.canPost = false;
        updateCreatePostUI();
        state.feedPage = 1;
        state.feedHasMore = true;
        loadFeed();
    } catch (err) { alert(err.message); dom.publishBtn.disabled = false; }
});

function updateCreatePostUI() {
    const i = dom.openPostModal;
    if (state.canPost) { i.textContent = 'Что у вас нового?'; i.style.color = ''; }
    else { i.textContent = 'Вы уже опубликовали пост сегодня'; i.style.color = '#999'; }
}

// App entry
async function enterApp() {
    try {
        const d = await api('/api/me');
        state.user = d.user; state.user.id = String(state.user.id); state.canPost = d.canPost;
        dom.authBlock.classList.add('hidden');
        dom.appBlock.classList.remove('hidden');
        updateSidebar();
        updateCreatePostUI();
        loadFeed();
        updateUnreadBadge();
        state.unreadInterval = setInterval(updateUnreadBadge, 5000);
    } catch (err) { logout(); }
}

function updateSidebar() {
    const a = state.user.avatarUrl ? `<img src="${state.user.avatarUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : state.user.username.charAt(0).toUpperCase();
    $('#sidebarAvatar').innerHTML = a;
    $('#createPostAvatar').innerHTML = a;
    $('#sidebarUsername').textContent = state.user.username;
}

// Feed with infinite scroll
async function loadFeed(append = false) {
    if (state.feedLoading) return;
    state.feedLoading = true;
    
    if (!append) {
        dom.feedContainer.innerHTML = '<div class="skeleton skeleton-card"></div>'.repeat(3);
    }
    
    try {
        const posts = await api(`/api/posts?page=${state.feedPage}`);
        if (!append) {
            dom.feedContainer.innerHTML = '<div class="feed-title">Новости</div>';
            if (!posts.length) {
                dom.feedContainer.innerHTML = '<div class="empty-feed"><div class="empty-icon"><svg viewBox="0 0 80 80" width="64" height="64"><rect x="12" y="16" width="56" height="48" rx="8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><line x1="24" y1="32" x2="56" y2="32" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><line x1="24" y1="42" x2="48" y2="42" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.5"/></svg></div><h3>Лента пуста</h3><p>Здесь будут посты. Станьте первым!</p></div>';
                state.feedLoading = false;
                return;
            }
        }
        
        if (!posts.length) { state.feedHasMore = false; state.feedLoading = false; return; }
        
        const ids = posts.map(p => p.id);
        const likesData = await api('/api/likes', 'POST', { postIds: ids });
        
        posts.forEach((post, i) => {
            const div = document.createElement('div');
            div.className = 'post-card';
            div.style.animationDelay = (i * 0.03) + 's';
            const li = likesData[post.id] || { count: 0, liked: false };
            const av = post.authorAvatar ? `<img src="${post.authorAvatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" loading="lazy">` : post.author.charAt(0).toUpperCase();
            const del = (state.user && String(post.userId) === String(state.user.id)) ? `<button class="post-delete-btn" data-postid="${post.id}"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0v14a1 1 0 01-1 1H6a1 1 0 01-1-1V6h14M10 11v6m4-6v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : '';
            const ts = new Date(post.time).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
            
            div.innerHTML = `<div class="post-header"><div class="post-avatar" data-userid="${post.userId}">${av}</div><div class="post-author-info"><div class="post-author" data-userid="${post.userId}">${escapeHTML(post.author)}</div><div class="post-time">${ts}</div></div><div class="post-header-right">${del}</div></div><div class="post-body"><div class="post-text">${escapeHTML(post.content)}</div>${post.imageUrl ? `<img src="${post.imageUrl}" class="post-image" alt="Фото" loading="lazy">` : ''}</div><div class="post-footer"><button class="like-btn ${li.liked ? 'liked' : ''}" data-postid="${post.id}"><span class="like-icon">${li.liked ? '❤️' : '🤍'}</span><span class="like-count">${li.count > 0 ? li.count : ''}</span></button></div>`;
            
            div.querySelectorAll('[data-userid]').forEach(el => el.addEventListener('click', (e) => {
                if (!e.target.closest('.like-btn') && !e.target.closest('.post-delete-btn')) viewProfile(post.userId);
            }));
            
            div.querySelector('.like-btn').addEventListener('click', async function() {
                try {
                    const r = await api('/api/like', 'POST', { postId: post.id });
                    const icon = this.querySelector('.like-icon');
                    const count = this.querySelector('.like-count');
                    if (r.liked) { this.classList.add('liked', 'just-liked'); icon.textContent = '❤️'; setTimeout(() => this.classList.remove('just-liked'), 400); }
                    else { this.classList.remove('liked'); icon.textContent = '🤍'; }
                    count.textContent = r.count > 0 ? r.count : '';
                } catch (err) {}
            });
            
            const delBtn = div.querySelector('.post-delete-btn');
            if (delBtn) delBtn.addEventListener('click', async () => {
                if (confirm('Удалить пост?')) { try { await api('/api/post/' + post.id, 'DELETE'); state.feedPage = 1; state.feedHasMore = true; loadFeed(); } catch (err) { alert(err.message); } }
            });
            
            dom.feedContainer.appendChild(div);
        });
        
        state.feedPage++;
        if (posts.length < 20) state.feedHasMore = false;
        setupFeedObserver();
    } catch (err) { if (!append) dom.feedContainer.innerHTML = '<div class="empty-feed"><h3>Ошибка загрузки</h3><p>Попробуйте обновить страницу</p></div>'; }
    state.feedLoading = false;
}

function setupFeedObserver() {
    if (state.feedObserver) state.feedObserver.disconnect();
    const sentinel = document.createElement('div');
    sentinel.className = 'feed-sentinel';
    sentinel.style.height = '1px';
    dom.feedContainer.appendChild(sentinel);
    
    state.feedObserver = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && state.feedHasMore && !state.feedLoading) {
            loadFeed(true);
        }
    }, { rootMargin: '200px' });
    state.feedObserver.observe(sentinel);
}

// Profile
async function viewProfile(userId) {
    dom.sidebarBtns.forEach(b => b.classList.remove('active'));
    [dom.feedPage, dom.messagesPage, dom.settingsPage].forEach(p => p.classList.add('hidden'));
    dom.profilePage.classList.remove('hidden');
    dom.profilePage.innerHTML = '<div class="skeleton" style="height:200px;border-radius:16px;margin-bottom:20px;"></div>';
    try {
        const user = await api('/api/user/' + userId);
        const jd = new Date(user.createdAt).toLocaleDateString('ru-RU', { year: 'numeric', month: 'long', day: 'numeric' });
        const sn = user.username.replace(/'/g, "\\'");
        const mb = String(userId) !== String(state.user.id) ? `<button class="btn-msg" onclick="messageFromProfile('${userId}', '${sn}')">Написать</button>` : '';
        const av = user.avatarUrl ? `<div class="profile-avatar-wrapper"><img src="${user.avatarUrl}" alt="Аватар" loading="lazy"></div>` : `<div class="profile-avatar-placeholder">${user.username.charAt(0).toUpperCase()}</div>`;
        const bio = user.bio ? `<div class="profile-bio">${escapeHTML(user.bio)}</div>` : '';
        dom.profilePage.innerHTML = `<div class="profile-card">${av}<div class="profile-name">${escapeHTML(user.username)}</div>${bio}<div class="profile-date">На сайте с ${jd}</div><div class="profile-stats"><div><div class="stat-num">${user.totalPosts}</div><div class="stat-label">постов</div></div><div><div class="stat-num">${user.streak}🔥</div><div class="stat-label">дней подряд</div></div></div><div class="profile-btns">${mb}<button class="btn-back-profile" onclick="goToFeed()">← Назад</button></div></div>`;
        
        const posts = await api('/api/user/' + userId + '/posts');
        const pc = document.createElement('div'); pc.className = 'profile-posts';
        if (!posts.length) {
            pc.innerHTML = '<div class="empty-feed"><div class="empty-icon"><svg viewBox="0 0 80 80" width="48" height="48"><rect x="16" y="20" width="48" height="40" rx="6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><line x1="28" y1="34" x2="52" y2="34" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></div><h3>Нет постов</h3><p>Пользователь пока ничего не опубликовал</p></div>';
        } else {
            const ids = posts.map(p => p.id);
            const likesData = await api('/api/likes', 'POST', { postIds: ids });
            posts.forEach(post => {
                const div = document.createElement('div'); div.className = 'post-card';
                const li = likesData[post.id] || { count: 0, liked: false };
                const del = (state.user && String(post.userId) === String(state.user.id)) ? `<button class="post-delete-btn"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0v14a1 1 0 01-1 1H6a1 1 0 01-1-1V6h14M10 11v6m4-6v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : '';
                const ts = new Date(post.time).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
                div.innerHTML = `<div class="post-body"><div class="post-text">${escapeHTML(post.content)}</div>${post.imageUrl ? `<img src="${post.imageUrl}" class="post-image" alt="Фото" loading="lazy">` : ''}<div class="post-time">${ts}</div></div><div class="post-footer" style="display:flex;align-items:center;justify-content:space-between;"><button class="like-btn ${li.liked ? 'liked' : ''}" data-postid="${post.id}"><span class="like-icon">${li.liked ? '❤️' : '🤍'}</span><span class="like-count">${li.count > 0 ? li.count : ''}</span></button>${del}</div>`;
                div.querySelector('.like-btn').addEventListener('click', async function() {
                    try {
                        const r = await api('/api/like', 'POST', { postId: post.id });
                        const icon = this.querySelector('.like-icon');
                        const count = this.querySelector('.like-count');
                        if (r.liked) { this.classList.add('liked', 'just-liked'); icon.textContent = '❤️'; setTimeout(() => this.classList.remove('just-liked'), 400); }
                        else { this.classList.remove('liked'); icon.textContent = '🤍'; }
                        count.textContent = r.count > 0 ? r.count : '';
                    } catch (err) {}
                });
                const delBtn = div.querySelector('.post-delete-btn');
                if (delBtn) delBtn.addEventListener('click', async () => {
                    if (confirm('Удалить пост?')) { try { await api('/api/post/' + post.id, 'DELETE'); viewProfile(userId); } catch (err) { alert(err.message); } }
                });
                pc.appendChild(div);
            });
        }
        dom.profilePage.appendChild(pc);
    } catch (err) { dom.profilePage.innerHTML = '<div class="empty-feed"><h3>Пользователь не найден</h3></div>'; }
}

function messageFromProfile(userId, username) {
    dom.sidebarBtns.forEach(b => b.classList.remove('active'));
    $('[data-page="messages"]').classList.add('active');
    [dom.feedPage, dom.profilePage, dom.settingsPage].forEach(p => p.classList.add('hidden'));
    dom.messagesPage.classList.remove('hidden');
    openChat(userId, username); loadDialogs();
    if (window.innerWidth <= 768) { dom.dialogsSidebar.classList.add('chat-open'); dom.messagesLayout.classList.add('mobile-view'); }
}

function goToFeed() {
    dom.sidebarBtns.forEach(b => b.classList.remove('active'));
    $('[data-page="feed"]').classList.add('active');
    [dom.profilePage, dom.messagesPage, dom.settingsPage].forEach(p => p.classList.add('hidden'));
    dom.feedPage.classList.remove('hidden');
    dom.dialogsSidebar.classList.remove('chat-open');
    dom.messagesLayout.classList.remove('mobile-view');
}

// Messages
async function updateUnreadBadge() {
    try { const d = await api('/api/unread'); dom.msgBadge.classList.toggle('hidden', !d.count); if (d.count) dom.msgBadge.textContent = d.count; } catch (err) {}
}

async function loadDialogs() {
    try {
        const dialogs = await api('/api/dialogs');
        dom.dialogsList.innerHTML = dialogs.length ? '' : '<div class="no-dialogs">Нет диалогов</div>';
        dialogs.forEach(d => {
            const div = document.createElement('div'); div.className = 'dialog-item';
            if (String(state.chatPartner) === String(d.userId)) div.classList.add('active');
            const t = d.lastTime ? new Date(d.lastTime).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
            div.innerHTML = `<div class="dialog-avatar">${d.avatarUrl ? `<img src="${d.avatarUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" loading="lazy">` : d.username.charAt(0).toUpperCase()}</div><div class="dialog-info"><div class="dialog-name">${escapeHTML(d.username)}</div><div class="dialog-last">${escapeHTML(formatLastMsg(d.lastMessage || '').substring(0, 30))}</div></div><div class="dialog-meta"><div class="dialog-time">${t}</div>${d.unread > 0 ? `<div class="unread-badge">${d.unread}</div>` : ''}</div>`;
            div.addEventListener('click', () => openChat(d.userId, d.username, d.avatarUrl));
            dom.dialogsList.appendChild(div);
        });
    } catch (err) {}
}

function formatLastMsg(msg) {
    if (!msg) return '';
    try { const p = JSON.parse(msg); return (p && p.imageUrl) ? '📷 Фото' : msg; } catch (e) { return msg; }
}

$('#searchUserInput').addEventListener('input', function() {
    clearTimeout(this._timer);
    const q = this.value.trim();
    if (!q) { $('#searchResults').classList.add('hidden'); return; }
    this._timer = setTimeout(async () => {
        try {
            const users = await api('/api/users/search?q=' + encodeURIComponent(q));
            const results = $('#searchResults');
            results.classList.remove('hidden');
            results.innerHTML = users.length ? '' : '<div class="search-result-item" style="color:var(--text-secondary);">Никого нет</div>';
            users.forEach(u => {
                const div = document.createElement('div'); div.className = 'search-result-item'; div.textContent = u.username;
                div.addEventListener('click', () => { openChat(u.id, u.username, null); this.value = ''; results.classList.add('hidden'); });
                results.appendChild(div);
            });
        } catch (err) {}
    }, 300);
});

function openChat(userId, username, avatarUrl) {
    state.chatPartner = String(userId);
    state.lastMessagesHash = '';
    const av = avatarUrl ? `<img src="${avatarUrl}" class="chat-partner-avatar-img" alt="" loading="lazy">` : `<div class="chat-partner-avatar-placeholder">${username.charAt(0).toUpperCase()}</div>`;
    dom.chatPartnerText.innerHTML = `<span class="chat-partner-info" data-userid="${userId}" style="display:flex;align-items:center;gap:10px;cursor:pointer;">${av}<span>${escapeHTML(username)}</span></span>`;
    dom.chatPartnerText.querySelector('.chat-partner-info')?.addEventListener('click', (e) => { e.stopPropagation(); viewProfile(userId); });
    dom.messageInput.disabled = false;
    loadMessages(); loadDialogs();
    if (window.innerWidth <= 768) { dom.dialogsSidebar.classList.add('chat-open'); dom.messagesLayout.classList.add('mobile-view'); }
}

$('#chatBackBtn').addEventListener('click', () => {
    dom.dialogsSidebar.classList.remove('chat-open'); dom.messagesLayout.classList.remove('mobile-view');
    state.chatPartner = null; state.lastMessagesHash = '';
    dom.chatPartnerText.textContent = 'Выберите диалог';
    dom.messageInput.disabled = true; dom.sendMessageBtn.disabled = true;
    dom.chatMessages.innerHTML = '<div class="chat-empty"><div class="empty-chat-icon">💬</div>Выберите диалог или найдите пользователя</div>';
});

dom.messageInput.addEventListener('input', () => {
    dom.sendMessageBtn.disabled = !(dom.messageInput.value.trim() || state.chatPhoto);
});

async function loadMessages() {
    if (!state.chatPartner) { dom.chatMessages.innerHTML = '<div class="chat-empty">Выберите диалог</div>'; return; }
    try {
        const msgs = await api('/api/messages/' + state.chatPartner);
        const hash = JSON.stringify(msgs);
        if (hash === state.lastMessagesHash) return;
        state.lastMessagesHash = hash;
        dom.chatMessages.innerHTML = msgs.length ? '' : '<div class="chat-empty"><div class="empty-chat-icon">👋</div>Напишите первым!</div>';
        msgs.forEach(m => {
            const div = document.createElement('div');
            div.className = 'message ' + (String(m.from) === String(state.user.id) ? 'message-sent' : 'message-received');
            const t = new Date(m.time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
            div.innerHTML = (m.text ? escapeHTML(m.text) : '') + (m.imageUrl ? `<img src="${m.imageUrl}" class="message-image" alt="Фото" loading="lazy">` : '') + `<div class="message-time">${t}</div>`;
            dom.chatMessages.appendChild(div);
        });
        dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
        updateUnreadBadge();
    } catch (err) {}
}

async function sendMsg() {
    const t = dom.messageInput.value.trim();
    if ((!t && !state.chatPhoto) || !state.chatPartner) return;
    try {
        if (state.chatPhoto) {
            const fd = new FormData();
            fd.append('to', state.chatPartner);
            fd.append('text', t || '');
            fd.append('image', state.chatPhoto);
            const r = await fetch('/api/messages/photo', { method: 'POST', headers: { 'Authorization': 'Bearer ' + state.token }, body: fd });
            if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
        } else {
            await api('/api/messages', 'POST', { to: state.chatPartner, text: t });
        }
        dom.messageInput.value = '';
        state.chatPhoto = null;
        dom.chatPhotoInput.value = '';
        dom.chatPhotoPreview.classList.add('hidden');
        state.lastMessagesHash = '';
        loadMessages(); loadDialogs();
    } catch (err) { alert(err.message); }
}

dom.sendMessageBtn.addEventListener('click', sendMsg);
dom.messageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMsg(); });

dom.chatAttachBtn.addEventListener('click', () => dom.chatPhotoInput.click());
dom.chatPhotoInput.addEventListener('change', () => {
    const f = dom.chatPhotoInput.files[0];
    if (!f) return;
    state.chatPhoto = f;
    const reader = new FileReader();
    reader.onload = (e) => { $('#chatPhotoPreviewImg').src = e.target.result; dom.chatPhotoPreview.classList.remove('hidden'); dom.sendMessageBtn.disabled = false; };
    reader.readAsDataURL(f);
});
dom.chatRemovePhoto.addEventListener('click', () => { state.chatPhoto = null; dom.chatPhotoInput.value = ''; dom.chatPhotoPreview.classList.add('hidden'); dom.sendMessageBtn.disabled = !dom.messageInput.value.trim(); });

// Settings
async function loadSettings() {
    try { const d = await api('/api/settings'); $('#settingsUsername').value = d.username; $('#settingsBio').value = d.bio || ''; updateSettingsAvatar(d.avatarUrl, d.username); } catch (err) {}
}
function updateSettingsAvatar(url, name) {
    if (url) $('#settingsAvatarContainer').innerHTML = `<img src="${url}" class="settings-avatar-img" alt="Аватар">`;
    else $('#settingsAvatarContainer').innerHTML = `<div class="settings-avatar-placeholder">${name.charAt(0).toUpperCase()}</div>`;
}
$('#avatarInput').addEventListener('change', async () => {
    const f = $('#avatarInput').files[0];
    if (!f) return;
    const fd = new FormData(); fd.append('avatar', f);
    try {
        const r = await fetch('/api/settings', { method: 'POST', headers: { 'Authorization': 'Bearer ' + state.token }, body: fd });
        const d = await r.json(); if (!r.ok) throw new Error(d.error);
        state.user.avatarUrl = d.avatarUrl;
        updateSettingsAvatar(d.avatarUrl, state.user.username);
        updateSidebar();
        showSuccess('Аватар обновлён!');
    } catch (err) { alert(err.message); }
});
$('#saveProfile').addEventListener('click', async () => {
    const u = $('#settingsUsername').value.trim();
    const b = $('#settingsBio').value.trim();
    if (u.length < 3) return alert('Имя минимум 3 символа');
    try { const d = await api('/api/settings', 'POST', { username: u, bio: b }); state.user = d.user; state.user.id = String(state.user.id); updateSidebar(); showSuccess('Профиль сохранён!'); } catch (err) { alert(err.message); }
});
$('#savePassword').addEventListener('click', async () => {
    const p = $('#settingsPassword').value.trim();
    if (!p) return alert('Введите пароль');
    if (p.length < 4) return alert('Минимум 4 символа');
    try { await api('/api/settings', 'POST', { password: p }); $('#settingsPassword').value = ''; showSuccess('Пароль изменён!'); } catch (err) { alert(err.message); }
});
function showSuccess(msg) { const el = $('#settingsSuccess'); el.textContent = '✅ ' + msg; el.classList.remove('hidden'); setTimeout(() => el.classList.add('hidden'), 3000); }

// Polling
setInterval(() => { if (state.chatPartner && !dom.messagesPage.classList.contains('hidden')) loadMessages(); }, 3000);
setInterval(() => { if (!dom.messagesPage.classList.contains('hidden')) loadDialogs(); }, 5000);

// Utils
function escapeHTML(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// Init
if (state.token) enterApp();