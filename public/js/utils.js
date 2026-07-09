// ========== УТИЛИТЫ ==========

// API
let token = localStorage.getItem('token') || '';

function setToken(t) { token = t; }

async function api(url, method = 'GET', body = null) {
    const h = {};
    if (body && !(body instanceof FormData)) h['Content-Type'] = 'application/json';
    if (token) h['Authorization'] = 'Bearer ' + token;
    const o = { method, headers: h };
    if (body) o.body = body instanceof FormData ? body : JSON.stringify(body);
    const r = await fetch(url, o);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Ошибка');
    return d;
}

// Тема
function applyTheme(dark) {
    const toggle = document.getElementById('themeToggle');
    if (dark) {
        document.documentElement.setAttribute('data-theme', 'dark');
        if (toggle) toggle.checked = true;
    } else {
        document.documentElement.removeAttribute('data-theme');
        if (toggle) toggle.checked = false;
    }
}

function initTheme() {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark') applyTheme(true);
    else if (saved === 'light') applyTheme(false);
    else if (matchMedia('(prefers-color-scheme: dark)').matches) applyTheme(true);
    else applyTheme(false);
    
    const toggle = document.getElementById('themeToggle');
    if (toggle) {
        toggle.addEventListener('change', () => {
            const d = toggle.checked;
            applyTheme(d);
            localStorage.setItem('theme', d ? 'dark' : 'light');
        });
    }
}

// Эскейп HTML
function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

// Онлайн-точка
function onlineDot(online) {
    return online ? '<span style="display:inline-block;width:10px;height:10px;background:#10B981;border-radius:50%;margin-left:6px;flex-shrink:0;" title="Онлайн"></span>' : '';
}

// Формат даты
function formatTime(iso) {
    return new Date(iso).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
}

function formatTimeShort(iso) {
    return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

// Скелетоны
function showSkeletons(container) {
    container.innerHTML = '<div class="skeleton skeleton-card"></div>'.repeat(3);
}
