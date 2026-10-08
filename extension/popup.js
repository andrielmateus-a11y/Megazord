const LABELS = { connected: 'Conectado', connecting: 'Conectando…', disconnected: 'Desconectado', not_configured: 'Não configurado' };

async function refresh() {
  const s = await browser.runtime.sendMessage({ type: 'getState' });
  document.getElementById('status').className = `status ${s.status}`;
  document.getElementById('statusText').textContent = LABELS[s.status] || s.status;
  document.getElementById('error').textContent = s.lastError || '';
  const url = document.getElementById('serverUrl');
  if (!url.value) url.value = s.config.serverUrl;
  document.getElementById('token').placeholder = s.config.hasToken ? 'Token salvo (preencha para trocar)' : 'mzb_...';
  document.getElementById('log').innerHTML = s.log.map((l) => `<li>${new Date(l.at).toLocaleTimeString()} — ${l.message.replace(/</g, '&lt;')}</li>`).join('');
}

document.getElementById('save').addEventListener('click', async () => {
  await browser.runtime.sendMessage({
    type: 'saveConfig',
    serverUrl: document.getElementById('serverUrl').value.trim(),
    token: document.getElementById('token').value.trim(),
  });
  document.getElementById('token').value = '';
  setTimeout(refresh, 800);
});
document.getElementById('reconnect').addEventListener('click', async () => {
  await browser.runtime.sendMessage({ type: 'reconnect' });
  setTimeout(refresh, 800);
});

refresh();
setInterval(refresh, 2000);
