let token = localStorage.getItem('token') || '';

const authBlock = document.getElementById('authBlock');
const appBlock = document.getElementById('appBlock');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const tabBtns = document.querySelectorAll('.tab-btn');

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        loginForm.classList.toggle('hidden', btn.dataset.tab !== 'login');
        registerForm.classList.toggle('hidden', btn.dataset.tab !== 'register');
    });
});

async function apiCall(url, method, body = null) {
    const h = {};
    if (body) h['Content-Type'] = 'application/json';
    if (token) h['Authorization'] = 'Bearer ' + token;
    const o = { method, headers: h };
    if (body) o.body = JSON.stringify(body);
    const r = await fetch(url, o);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Ошибка');
    return d;
}

function enterApp(user) {
    authBlock.classList.add('hidden');
    appBlock.classList.remove('hidden');
    if (typeof window.initApp === 'function') {
        window.initApp(user);
    }
}

document.getElementById('registerFormEl').addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = document.getElementById('regUsername').value.trim();
    const p = document.getElementById('regPassword').value;
    document.getElementById('registerError').textContent = '';
    try {
        const d = await apiCall('/api/register', 'POST', { username: u, password: p });
        token = d.token;
        localStorage.setItem('token', token);
        enterApp(d.user);
    } catch (err) {
        document.getElementById('registerError').textContent = err.message;
    }
});

document.getElementById('loginFormEl').addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = document.getElementById('loginUsername').value.trim();
    const p = document.getElementById('loginPassword').value;
    document.getElementById('loginError').textContent = '';
    try {
        const d = await apiCall('/api/login', 'POST', { username: u, password: p });
        token = d.token;
        localStorage.setItem('token', token);
        enterApp(d.user);
    } catch (err) {
        document.getElementById('loginError').textContent = err.message;
    }
});
