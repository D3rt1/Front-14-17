const offlineBadge = document.getElementById('offline-badge');
const contentDiv = document.getElementById('app-content');
const homeBtn = document.getElementById('home-btn');
const aboutBtn = document.getElementById('about-btn');

// --- Socket.IO ---
const socket = io('https://localhost:3001');

// --- Офлайн-индикатор ---
function updateOnlineStatus() {
  offlineBadge.style.display = navigator.onLine ? 'none' : 'inline-block';
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();

// --- Навигация ---
function setActiveButton(activeId) {
  [homeBtn, aboutBtn].forEach(btn => btn.classList.remove('active'));
  document.getElementById(activeId).classList.add('active');
}

async function loadContent(page) {
  try {
    const response = await fetch(`/content/${page}.html`);
    const html = await response.text();
    contentDiv.innerHTML = html;
    if (page === 'home') {
      initNotes();
    }
  } catch (err) {
    contentDiv.innerHTML = `<p style="color:red;">Ошибка загрузки страницы.</p>`;
    console.error(err);
  }
}

homeBtn.addEventListener('click', () => {
  setActiveButton('home-btn');
  loadContent('home');
});
aboutBtn.addEventListener('click', () => {
  setActiveButton('about-btn');
  loadContent('about');
});

loadContent('home');

// --- Получение события от других клиентов ---
socket.on('taskAdded', (task) => {
  console.log('📨 Задача от другого клиента:', task);
  const popup = document.createElement('div');
  popup.textContent = `📝 Новая заметка: ${task.text}`;
  popup.style.cssText = `
    position: fixed; top: 15px; right: 15px;
    background: #4285f4; color: white;
    padding: 12px 18px; border-radius: 8px;
    z-index: 9999; font-size: 0.95em;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  `;
  document.body.appendChild(popup);
  setTimeout(() => popup.remove(), 3000);
});

// --- Логика заметок ---
function initNotes() {
  const form = document.getElementById('note-form');
  const input = document.getElementById('note-input');
  const list = document.getElementById('notes-list');

  function loadNotes() {
    const notes = JSON.parse(localStorage.getItem('notes') || '[]');
    list.innerHTML = notes
      .map((note, i) => `
        <li>
          ${note}
          <button onclick="deleteNote(${i})"
            style="float:right;background:none;border:none;
                   color:#e53935;cursor:pointer;font-size:1em;">✕</button>
        </li>`)
      .join('');
  }

  function addNote(text) {
    const notes = JSON.parse(localStorage.getItem('notes') || '[]');
    notes.push(text);
    localStorage.setItem('notes', JSON.stringify(notes));
    loadNotes();
    socket.emit('newTask', { text, timestamp: Date.now() });
  }

  window.deleteNote = function(index) {
    const notes = JSON.parse(localStorage.getItem('notes') || '[]');
    notes.splice(index, 1);
    localStorage.setItem('notes', JSON.stringify(notes));
    loadNotes();
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (text) {
      addNote(text);
      input.value = '';
    }
  });

  loadNotes();
}

// --- Push-уведомления ---
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array('BIc9NAfTlfCR4sfkddVGjVbAmeoACBfvnaM_D-en4XbgtKfxbFDV0ENPEicLTd3fYq8ZKP-U07wcGJ8_FyrwArI')
    });
    await fetch('https://localhost:3001/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription)
    });
    localStorage.setItem('pushEnabled', 'true');
    registration.active.postMessage({ type: 'SET_PUSH_ENABLED', value: true });
    console.log('✅ Подписка на push оформлена');
  } catch (err) {
    console.error('❌ Ошибка подписки:', err);
  }
}

async function unsubscribeFromPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    localStorage.setItem('pushEnabled', 'false');
    const registration = await navigator.serviceWorker.ready;
    registration.active.postMessage({ type: 'SET_PUSH_ENABLED', value: false });
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await fetch('https://localhost:3001/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint })
      });
      await subscription.unsubscribe();
    }
    console.log('✅ Отписка выполнена');
  } catch (err) {
    console.error('❌ Ошибка отписки:', err);
  }
}

// --- Service Worker + кнопки push ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      console.log('✅ SW зарегистрирован:', reg.scope);

      const enableBtn = document.getElementById('enable-push');
      const disableBtn = document.getElementById('disable-push');

      if ('PushManager' in window && enableBtn && disableBtn) {
        const subscription = await reg.pushManager.getSubscription();
        const pushEnabled = localStorage.getItem('pushEnabled');

        if (subscription && pushEnabled === 'true') {
          enableBtn.style.display = 'none';
          disableBtn.style.display = 'inline-block';
        } else {
          enableBtn.style.display = 'inline-block';
          disableBtn.style.display = 'none';
        }

        enableBtn.addEventListener('click', async () => {
          if (Notification.permission === 'denied') {
            alert('Уведомления заблокированы. Разрешите их в настройках браузера.');
            return;
          }
          if (Notification.permission === 'default') {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
              alert('Нужно разрешить уведомления.');
              return;
            }
          }
          await subscribeToPush();
          enableBtn.style.display = 'none';
          disableBtn.style.display = 'inline-block';
        });

        disableBtn.addEventListener('click', async () => {
          await unsubscribeFromPush();
          disableBtn.style.display = 'none';
          enableBtn.style.display = 'inline-block';
        });
      }

    } catch (err) {
      console.error('❌ Ошибка регистрации SW:', err);
    }
  });
}