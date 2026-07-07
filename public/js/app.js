let token = localStorage.getItem('token') || '';
let currentUser = null;
let currentChatPartner = null;
let unreadInterval = null;
let viewingUserId = null;
let canPostToday = true;
let selectedPhoto = null;

const authBlock = document.getElementById('authBlock');
const appBlock = document.getElementById('appBlock');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const tabBtns = document.querySelectorAll('.tab-btn');
const logoutBtn = document.getElementById('logoutBtn');
const msgBadge = document.getElementById('msgBadge');

const feedPage = document.getElementById('feedPage');
const profilePage = document.getElementById('profilePage');
const messagesPage = document.getElementById('messagesPage');
const settingsPage = document.getElementById('settingsPage');
const sidebarBtns = document.querySelectorAll('.sidebar-btn');

const postModal = document.getElementById('postModal');
const openPostModal = document.getElementById('openPostModal');
const closeModal = document.getElementById('closeModal');
const postTextarea = document.getElementById('postTextarea');
const publishBtn = document.getElementById('publishBtn');
const postLimitWarning = document.getElementById('postLimitWarning');
const feedContainer = document.getElementById('feedContainer');

const photoInput = document.getElementById('photoInput');
const photoLabel = document.getElementById('photoLabel');
const photoPreview = document.getElementById('photoPreview');
const photoPreviewImg = document.getElementById('photoPreviewImg');
const removePhoto = document.getElementById('removePhoto');

const dialogsList = document.getElementById('dialogsList');
const chatPartnerName = document.getElementById('chatPartnerName');
const chatMessages = document.getElementById('chatMessages');
const messageInput = document.getElementById('messageInput');
const sendMessageBtn = document.getElementById('sendMessageBtn');
const searchUserInput = document.getElementById('searchUserInput');
const searchResults = document.getElementById('searchResults');

const settingsUsername = document.getElementById('settingsUsername');
const settingsBio = document.getElementById('settingsBio');
const settingsPassword = document.getElementById('settingsPassword');
const settingsAvatarContainer = document.getElementById('settingsAvatarContainer');
const avatarInput = document.getElementById('avatarInput');
const settingsSuccess = document.getElementById('settingsSuccess');
const saveProfile = document.getElementById('saveProfile');
const savePassword = document.getElementById('savePassword');

// === АВТОРИЗАЦИЯ ===
tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        loginForm.classList.toggle('hidden', tab !== 'login');
        registerForm.classList.toggle('hidden', tab !== 'register');
    });
});

document.getElementById('registerFormEl').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('regUsername').value.trim();
    const password = document.getElementById('regPassword').value;
    const errorEl = document.getElementById('registerError');
    errorEl.textContent = '';
    try {
        const data = await apiCall('/api/register', 'POST', { username, password });
        token = data.token;
        currentUser = data.user;
        localStorage.setItem('token', token);
        showApp();
    } catch (err) { errorEl.textContent = err.message; }
});

document.getElementById('loginFormEl').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errorEl = document.getElementById('loginError');
    errorEl.textContent = '';
    try {
        const data = await apiCall('/api/login', 'POST', { username, password });
        token = data.token;
        currentUser = data.user;
        localStorage.setItem('token', token);
        showApp();
    } catch (err) { errorEl.textContent = err.message; }
});

logoutBtn.addEventListener('click', () => {
    token = '';
    currentUser = null;
    currentChatPartner = null;
    viewingUserId = null;
    localStorage.removeItem('token');
    clearInterval(unreadInterval);
    authBlock.classList.remove('hidden');
    appBlock.classList.add('hidden');
});

// === НАВИГАЦИЯ ===
sidebarBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const page = btn.dataset.page;
        sidebarBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        feedPage.classList.add('hidden');
        profilePage.classList.add('hidden');
        messagesPage.classList.add('hidden');
        settingsPage.classList.add('hidden');
        if (page === 'feed') { feedPage.classList.remove('hidden'); viewingUserId = null; }
        else if (page === 'messages') { messagesPage.classList.remove('hidden'); viewingUserId = null; loadDialogs(); }
        else if (page === 'settings') { settingsPage.classList.remove('hidden'); viewingUserId = null; loadSettings(); }
    });
});

// === МОДАЛКА ===
openPostModal.addEventListener('click', () => {
    if (canPostToday) { postModal.classList.remove('hidden'); postTextarea.focus(); postLimitWarning.classList.add('hidden'); publishBtn.disabled = false; }
    else { postModal.classList.remove('hidden'); postLimitWarning.classList.remove('hidden'); publishBtn.disabled = true; }
});

closeModal.addEventListener('click', () => { postModal.classList.add('hidden'); postTextarea.value = ''; clearPhoto(); });
postModal.addEventListener('click', (e) => { if (e.target === postModal) { postModal.classList.add('hidden'); postTextarea.value = ''; clearPhoto(); } });

function clearPhoto() {
    selectedPhoto = null; photoInput.value = '';
    photoPreview.classList.add('hidden'); photoLabel.classList.remove('has-photo'); photoLabel.textContent = '📷 Фото';
}

photoInput.addEventListener('change', () => {
    const file = photoInput.files[0];
    if (file) { selectedPhoto = file; const reader = new FileReader(); reader.onload = (e) => { photoPreviewImg.src = e.target.result; photoPreview.classList.remove('hidden'); photoLabel.classList.add('has-photo'); photoLabel.textContent = '📷 Фото выбрано'; }; reader.readAsDataURL(file); }
});
removePhoto.addEventListener('click', clearPhoto);

publishBtn.addEventListener('click', async () => {
    const content = postTextarea.value.trim();
    if (!content) return;
    publishBtn.disabled = true; publishBtn.textContent = 'Публикуем...';
    try {
        const formData = new FormData(); formData.append('content', content);
        if (selectedPhoto) formData.append('image', selectedPhoto);
        const response = await fetch('/api/post', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: formData });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Ошибка');
        postTextarea.value = ''; postModal.classList.add('hidden'); clearPhoto();
        canPostToday = false; updateCreatePostUI(); loadFeed();
    } catch (err) { alert(err.message); publishBtn.disabled = false; publishBtn.textContent = 'Опубликовать'; }
});

// === API ===
async function apiCall(url, method, body = null) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Ошибка сервера');
    return data;
}

// === ЗАПУСК ===
async function showApp() {
    try {
        const data = await apiCall('/api/me', 'GET');
        currentUser = data.user;
        currentUser.id = String(currentUser.id);
        canPostToday = data.canPost;
        authBlock.classList.add('hidden'); appBlock.classList.remove('hidden');
        updateAllUI(); updateCreatePostUI(); loadFeed(); updateUnreadBadge();
        unreadInterval = setInterval(updateUnreadBadge, 5000);
    } catch (err) { token = ''; localStorage.removeItem('token'); authBlock.classList.remove('hidden'); appBlock.classList.add('hidden'); }
}

function updateAllUI() {
    const avatarHtml = currentUser.avatarUrl ? `<img src="${currentUser.avatarUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : currentUser.username.charAt(0).toUpperCase();
    document.getElementById('sidebarAvatar').innerHTML = avatarHtml;
    document.getElementById('createPostAvatar').innerHTML = avatarHtml;
    document.getElementById('sidebarUsername').textContent = currentUser.username;
}

function updateCreatePostUI() {
    const input = document.getElementById('openPostModal');
    if (canPostToday) { input.textContent = 'Что у вас нового?'; input.style.color = '#818C99'; }
    else { input.textContent = 'Вы уже опубликовали пост сегодня'; input.style.color = '#999'; }
}

// === ЛЕНТА ===
async function loadFeed() {
    try {
        const posts = await apiCall('/api/posts', 'GET');
        if (!posts || posts.length === 0) { feedContainer.innerHTML = '<div class="empty-feed"><div class="icon">🐣</div><p>Лента пуста.</p></div>'; return; }
        const postIds = posts.map(p => p.id);
        const likesData = await apiCall('/api/likes', 'POST', { postIds });
        feedContainer.innerHTML = '<div class="feed-title">Новости</div>';
        posts.forEach(post => {
            const div = document.createElement('div'); div.className = 'post-card';
            const timeStr = new Date(post.time).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
            const likeInfo = likesData[post.id] || { count: 0, liked: false };
            const avatarHtml = post.authorAvatar ? `<img src="${post.authorAvatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : post.author.charAt(0).toUpperCase();
            const isMyPost = currentUser && String(post.userId) === String(currentUser.id);
            const deleteBtnHtml = isMyPost ? `<button class="post-delete-btn" data-postid="${post.id}" title="Удалить">🗑️</button>` : '';
            div.innerHTML = `
                <div class="post-header">
                    <div class="post-avatar" data-userid="${post.userId}">${avatarHtml}</div>
                    <div class="post-author-info"><div class="post-author" data-userid="${post.userId}">${escapeHTML(post.author)}</div><div class="post-time">${timeStr}</div></div>
                    <div class="post-header-right">${deleteBtnHtml}</div>
                </div>
                <div class="post-body"><div class="post-text">${escapeHTML(post.content)}</div>${post.imageUrl ? `<img src="${post.imageUrl}" class="post-image" alt="Фото" loading="lazy">` : ''}</div>
                <div class="post-footer">
                    <button class="like-btn ${likeInfo.liked ? 'liked' : ''}" data-postid="${post.id}"><span class="like-icon">${likeInfo.liked ? '❤️' : '🤍'}</span><span class="like-count">${likeInfo.count > 0 ? likeInfo.count : ''}</span></button>
                </div>
            `;
            div.querySelectorAll('[data-userid]').forEach(el => { el.addEventListener('click', (e) => { if (!e.target.closest('.like-btn') && !e.target.closest('.post-delete-btn')) viewProfile(post.userId); }); });
            const likeBtn = div.querySelector('.like-btn');
            likeBtn.addEventListener('click', async () => {
                try {
                    const result = await apiCall('/api/like', 'POST', { postId: post.id });
                    const icon = likeBtn.querySelector('.like-icon'); const count = likeBtn.querySelector('.like-count');
                    if (result.liked) { likeBtn.classList.add('liked', 'just-liked'); icon.textContent = '❤️'; setTimeout(() => likeBtn.classList.remove('just-liked'), 400); }
                    else { likeBtn.classList.remove('liked'); icon.textContent = '🤍'; }
                    count.textContent = result.count > 0 ? result.count : '';
                } catch (err) {}
            });
            const deleteBtn = div.querySelector('.post-delete-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', async () => {
                    if (confirm('Удалить этот пост?')) {
                        try { await apiCall('/api/post/' + post.id, 'DELETE'); loadFeed(); } catch (err) { alert('Ошибка: ' + err.message); }
                    }
                });
            }
            feedContainer.appendChild(div);
        });
    } catch (err) { feedContainer.innerHTML = '<div class="empty-feed">Ошибка загрузки</div>'; }
}

// === ПРОФИЛЬ ===
async function viewProfile(userId) {
    viewingUserId = userId;
    sidebarBtns.forEach(b => b.classList.remove('active'));
    feedPage.classList.add('hidden'); messagesPage.classList.add('hidden'); settingsPage.classList.add('hidden'); profilePage.classList.remove('hidden');
    profilePage.innerHTML = '';
    try {
        const user = await apiCall('/api/user/' + userId, 'GET');
        const joinedDate = new Date(user.createdAt).toLocaleDateString('ru-RU', { year: 'numeric', month: 'long', day: 'numeric' });
        const safeName = user.username.replace(/'/g, "\\'");
        let msgBtn = '';
        if (String(userId) !== String(currentUser.id)) msgBtn = `<button class="btn-msg" onclick="messageFromProfile('${userId}', '${safeName}')">💬 Написать</button>`;
        const avatarHtml = user.avatarUrl ? `<div class="profile-avatar-wrapper"><img src="${user.avatarUrl}" alt="Аватар"></div>` : `<div class="profile-avatar-placeholder">${user.username.charAt(0).toUpperCase()}</div>`;
        const bioHtml = user.bio ? `<div class="profile-bio">${escapeHTML(user.bio)}</div>` : '';
        profilePage.innerHTML = `<div class="profile-card">${avatarHtml}<div class="profile-name">${escapeHTML(user.username)}</div>${bioHtml}<div class="profile-date">На сайте с ${joinedDate}</div><div class="profile-stats"><div><div class="stat-num">${user.totalPosts}</div><div class="stat-label">постов</div></div><div><div class="stat-num">🔥 ${user.streak}</div><div class="stat-label">дней подряд</div></div></div><div class="profile-btns">${msgBtn}<button class="btn-back-profile" onclick="goToFeed()">← Назад</button></div></div>`;
        
        const posts = await apiCall('/api/user/' + userId + '/posts', 'GET');
        const postsContainer = document.createElement('div'); postsContainer.className = 'profile-posts';
        if (!posts || posts.length === 0) { postsContainer.innerHTML = '<div class="empty-feed"><div class="icon">📭</div><p>У пользователя пока нет постов</p></div>'; }
        else {
            const postIds = posts.map(p => p.id);
            const likesData = await apiCall('/api/likes', 'POST', { postIds });
            posts.forEach(post => {
                const div = document.createElement('div'); div.className = 'post-card';
                const timeStr = new Date(post.time).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
                const likeInfo = likesData[post.id] || { count: 0, liked: false };
                const isMyPost = currentUser && String(post.userId) === String(currentUser.id);
                const deleteBtnHtml = isMyPost ? `<button class="post-delete-btn" data-postid="${post.id}" title="Удалить">🗑️</button>` : '';
                div.innerHTML = `<div class="post-body"><div class="post-text">${escapeHTML(post.content)}</div>${post.imageUrl ? `<img src="${post.imageUrl}" class="post-image" alt="Фото" loading="lazy">` : ''}<div class="post-time">${timeStr}</div></div><div class="post-footer" style="display:flex;align-items:center;justify-content:space-between;"><button class="like-btn ${likeInfo.liked ? 'liked' : ''}" data-postid="${post.id}"><span class="like-icon">${likeInfo.liked ? '❤️' : '🤍'}</span><span class="like-count">${likeInfo.count > 0 ? likeInfo.count : ''}</span></button>${deleteBtnHtml}</div>`;
                const likeBtn = div.querySelector('.like-btn');
                likeBtn.addEventListener('click', async () => {
                    try {
                        const result = await apiCall('/api/like', 'POST', { postId: post.id });
                        const icon = likeBtn.querySelector('.like-icon'); const count = likeBtn.querySelector('.like-count');
                        if (result.liked) { likeBtn.classList.add('liked', 'just-liked'); icon.textContent = '❤️'; setTimeout(() => likeBtn.classList.remove('just-liked'), 400); }
                        else { likeBtn.classList.remove('liked'); icon.textContent = '🤍'; }
                        count.textContent = result.count > 0 ? result.count : '';
                    } catch (err) {}
                });
                const deleteBtn = div.querySelector('.post-delete-btn');
                if (deleteBtn) { deleteBtn.addEventListener('click', async () => { if (confirm('Удалить этот пост?')) { try { await apiCall('/api/post/' + post.id, 'DELETE'); viewProfile(userId); } catch (err) { alert('Ошибка: ' + err.message); } } }); }
                postsContainer.appendChild(div);
            });
        }
        profilePage.appendChild(postsContainer);
    } catch (err) { profilePage.innerHTML = '<div class="empty-feed">Пользователь не найден</div>'; }
}

function messageFromProfile(userId, username) {
    sidebarBtns.forEach(b => b.classList.remove('active'));
    document.querySelector('[data-page="messages"]').classList.add('active');
    feedPage.classList.add('hidden'); profilePage.classList.add('hidden'); settingsPage.classList.add('hidden'); messagesPage.classList.remove('hidden');
    openChat(userId, username); loadDialogs();
}

function goToFeed() {
    sidebarBtns.forEach(b => b.classList.remove('active'));
    document.querySelector('[data-page="feed"]').classList.add('active');
    profilePage.classList.add('hidden'); messagesPage.classList.add('hidden'); settingsPage.classList.add('hidden'); feedPage.classList.remove('hidden');
    viewingUserId = null;
}

// === НАСТРОЙКИ ===
async function loadSettings() {
    try { const data = await apiCall('/api/settings', 'GET'); settingsUsername.value = data.username; settingsBio.value = data.bio || ''; updateSettingsAvatar(data.avatarUrl, data.username); } catch (err) {}
}
function updateSettingsAvatar(avatarUrl, username) {
    if (avatarUrl) settingsAvatarContainer.innerHTML = `<img src="${avatarUrl}" class="settings-avatar-img" alt="Аватар">`;
    else settingsAvatarContainer.innerHTML = `<div class="settings-avatar-placeholder">${username.charAt(0).toUpperCase()}</div>`;
}
avatarInput.addEventListener('change', async () => {
    const file = avatarInput.files[0]; if (!file) return;
    const formData = new FormData(); formData.append('avatar', file);
    try { const response = await fetch('/api/settings', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: formData }); const data = await response.json(); if (!response.ok) throw new Error(data.error); currentUser.avatarUrl = data.avatarUrl; updateSettingsAvatar(data.avatarUrl, currentUser.username); updateAllUI(); showSuccess('Аватар обновлён!'); } catch (err) { alert('Ошибка: ' + err.message); }
});
saveProfile.addEventListener('click', async () => {
    const username = settingsUsername.value.trim(); const bio = settingsBio.value.trim();
    if (username.length < 3) return alert('Имя минимум 3 символа');
    try { const data = await apiCall('/api/settings', 'POST', { username, bio }); currentUser = data.user; currentUser.id = String(currentUser.id); updateAllUI(); showSuccess('Профиль сохранён!'); } catch (err) { alert('Ошибка: ' + err.message); }
});
savePassword.addEventListener('click', async () => {
    const password = settingsPassword.value.trim(); if (!password) return alert('Введите новый пароль'); if (password.length < 4) return alert('Пароль минимум 4 символа');
    try { await apiCall('/api/settings', 'POST', { password }); settingsPassword.value = ''; showSuccess('Пароль изменён!'); } catch (err) { alert('Ошибка: ' + err.message); }
});
function showSuccess(msg) { settingsSuccess.textContent = '✅ ' + msg; settingsSuccess.classList.remove('hidden'); setTimeout(() => settingsSuccess.classList.add('hidden'), 3000); }

// === СООБЩЕНИЯ ===
async function updateUnreadBadge() { try { const data = await apiCall('/api/unread', 'GET'); if (data.count > 0) { msgBadge.textContent = data.count; msgBadge.classList.remove('hidden'); } else msgBadge.classList.add('hidden'); } catch (err) {} }
async function loadDialogs() {
    try {
        const dialogs = await apiCall('/api/dialogs', 'GET'); dialogsList.innerHTML = '';
        if (dialogs.length === 0) { dialogsList.innerHTML = '<div class="no-dialogs">Нет диалогов</div>'; }
        dialogs.forEach(dialog => {
            const div = document.createElement('div'); div.className = 'dialog-item';
            if (String(currentChatPartner) === String(dialog.userId)) div.classList.add('active');
            const time = dialog.lastTime ? new Date(dialog.lastTime).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
            div.innerHTML = `<div class="dialog-avatar">${dialog.avatarUrl ? `<img src="${dialog.avatarUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : dialog.username.charAt(0).toUpperCase()}</div><div class="dialog-info"><div class="dialog-name">${escapeHTML(dialog.username)}</div><div class="dialog-last">${escapeHTML((dialog.lastMessage || '').substring(0, 30))}</div></div><div class="dialog-meta"><div class="dialog-time">${time}</div>${dialog.unread > 0 ? `<div class="unread-badge">${dialog.unread}</div>` : ''}</div>`;
            div.addEventListener('click', () => openChat(dialog.userId, dialog.username));
            dialogsList.appendChild(div);
        });
    } catch (err) {}
}
let searchTimeout;
searchUserInput.addEventListener('input', () => {
    clearTimeout(searchTimeout); const query = searchUserInput.value.trim();
    if (!query) { searchResults.classList.add('hidden'); return; }
    searchTimeout = setTimeout(async () => {
        try { const users = await apiCall('/api/users/search?q=' + encodeURIComponent(query), 'GET'); searchResults.classList.remove('hidden'); searchResults.innerHTML = ''; if (users.length === 0) searchResults.innerHTML = '<div class="search-result-item" style="color:#999;">Никого нет</div>'; users.forEach(user => { const div = document.createElement('div'); div.className = 'search-result-item'; div.textContent = '👤 ' + user.username; div.addEventListener('click', () => { openChat(user.id, user.username); searchUserInput.value = ''; searchResults.classList.add('hidden'); }); searchResults.appendChild(div); }); } catch (err) {}
    }, 300);
});
function openChat(userId, username) { currentChatPartner = String(userId); chatPartnerName.textContent = '💬 ' + username; messageInput.disabled = false; sendMessageBtn.disabled = false; loadMessages(); loadDialogs(); }
async function loadMessages() {
    if (!currentChatPartner) { chatMessages.innerHTML = '<div class="chat-empty">Выберите диалог</div>'; return; }
    try {
        const messages = await apiCall('/api/messages/' + currentChatPartner, 'GET');
        chatMessages.innerHTML = '';
        if (messages.length === 0) chatMessages.innerHTML = '<div class="chat-empty">Напишите первым! 👋</div>';
        messages.forEach(msg => {
            const div = document.createElement('div');
            const isMyMessage = String(msg.from) === String(currentUser.id);
            div.className = 'message ' + (isMyMessage ? 'message-sent' : 'message-received');
            const time = new Date(msg.time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
            div.innerHTML = escapeHTML(msg.text) + '<div class="message-time">' + time + '</div>';
            chatMessages.appendChild(div);
        });
        chatMessages.scrollTop = chatMessages.scrollHeight;
        updateUnreadBadge();
    } catch (err) {}
}
async function sendMsg() {
    const text = messageInput.value.trim();
    if (!text || !currentChatPartner) return;
    try {
        await apiCall('/api/messages', 'POST', { to: currentChatPartner, text });
        messageInput.value = '';
        loadMessages();
        loadDialogs();
    } catch (err) { alert(err.message); }
}
sendMessageBtn.addEventListener('click', sendMsg);
messageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMsg(); });
setInterval(() => { if (currentChatPartner && !messagesPage.classList.contains('hidden')) loadMessages(); }, 3000);
setInterval(() => { if (!messagesPage.classList.contains('hidden')) loadDialogs(); }, 5000);

function escapeHTML(str) { const div = document.createElement('div'); div.textContent = str; return div.innerHTML; }

if (token) showApp();
