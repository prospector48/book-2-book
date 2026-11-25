// How the "search nearby books" page talks to the API.
const API = '/api';
const $ = (id) => document.getElementById(id);
let token = sessionStorage.getItem('token');
let coords = null;

function showMessage(text, isError) {
  $('message').textContent = text;
  $('message').className = isError ? 'error' : '';
}

// Small wrapper: adds the token, parses JSON, throws the API's clear error message.
async function api(path, options = {}) {
  const res = await fetch(API + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) {
    const details = (data.error.details || []).map((d) => `${d.field}: ${d.message}`).join('; ');
    throw new Error(details ? `${data.error.message} ${details}` : data.error.message);
  }
  return data;
}

function showApp() {
  $('loginBox').hidden = !!token;
  $('searchBox').hidden = !token;
  if (token && !coords && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (p) => {
        coords = { lat: p.coords.latitude, lng: p.coords.longitude };
        $('locStatus').textContent = 'Using your current location.';
      },
      () => { $('locStatus').textContent = 'Location blocked - using the location saved in your profile.'; }
    );
  }
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: $('email').value, password: $('password').value }),
    });
    token = data.token;
    sessionStorage.setItem('token', token);
    showMessage(`Welcome, ${data.user.full_name}!`);
    showApp();
  } catch (err) {
    showMessage(err.message, true);
  }
});

$('searchForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const params = new URLSearchParams({ q: $('q').value, radius_km: $('radius').value });
  if (coords) { params.set('lat', coords.lat); params.set('lng', coords.lng); }

  try {
    const data = await api(`/books/nearby?${params}`);
    showMessage(`${data.count} book(s) found`);
    const box = $('results');
    box.replaceChildren();
    for (const r of data.results) {
      const card = document.createElement('div');
      card.className = 'card';
      // textContent (not innerHTML) so user-entered text can never run as code
      const title = document.createElement('strong');
      title.textContent = r.title;
      const info = document.createElement('div');
      info.textContent = `${r.author} - ${r.condition || 'condition not set'}`;
      const owner = document.createElement('div');
      owner.className = 'muted';
      owner.textContent = `${r.owner_name} - ${r.distance_km} km away`;
      card.append(title, info, owner);
      box.append(card);
    }
  } catch (err) {
    if (/expired|Invalid token|Missing token/i.test(err.message)) {
      token = null;
      sessionStorage.removeItem('token');
      showApp();
    }
    showMessage(err.message, true);
  }
});

showApp();
