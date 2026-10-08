/* MEGAZORD Firefox Bridge — content script do WhatsApp Web.
 * Seletores centralizados: se o WhatsApp Web mudar o DOM, ajuste apenas SELECTORS.
 */
const SELECTORS = {
  ready: ['#pane-side', '[data-testid="chat-list"]', 'div[aria-label="Lista de conversas"]', 'div[aria-label="Chat list"]'],
  loggedOut: ['div[data-ref] canvas', 'canvas[aria-label*="Scan"]', 'canvas[aria-label*="Escaneie"]', '[data-testid="qrcode"]'],
  composer: ['footer div[contenteditable="true"]', 'div[aria-label="Digite uma mensagem"]', 'div[aria-label="Type a message"]'],
  sendButton: ['button[aria-label="Enviar"]', 'button[aria-label="Send"]', 'span[data-icon="send"]', 'span[data-icon="wds-ic-send-filled"]'],
  invalidPopup: ['div[data-animate-modal-popup="true"]', 'div[role="dialog"]'],
  outgoing: ['div.message-out'],
};

function q(list) {
  for (const s of list) {
    const el = document.querySelector(s);
    if (el) return el;
  }
  return null;
}

function status() {
  if (q(SELECTORS.loggedOut)) return 'logged_out';
  if (q(SELECTORS.ready)) return 'ready';
  return 'loading';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function invalidNumberShown() {
  const popup = q(SELECTORS.invalidPopup);
  return !!popup && /inv[aá]lid|n[aã]o est[aá] no whatsapp|isn.t on whatsapp/i.test(popup.textContent || '');
}

async function sendPrefilled(text, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (invalidNumberShown()) return { ok: false, code: 'invalid_number', message: 'Número inválido ou sem WhatsApp' };
    if (status() === 'logged_out') return { ok: false, code: 'invalid_session', message: 'Sessão expirada' };
    const composer = q(SELECTORS.composer);
    const button = q(SELECTORS.sendButton);
    if (composer && button && (composer.textContent || '').trim().length > 0) {
      const before = document.querySelectorAll(SELECTORS.outgoing[0]).length;
      (button.closest('button') || button).click();
      // Confirma: composer vazio e nova mensagem de saída na conversa.
      const confirmEnd = Date.now() + 15000;
      while (Date.now() < confirmEnd) {
        await sleep(500);
        const after = document.querySelectorAll(SELECTORS.outgoing[0]).length;
        const composerNow = q(SELECTORS.composer);
        if (after > before || (composerNow && !(composerNow.textContent || '').trim())) {
          const last = [...document.querySelectorAll(SELECTORS.outgoing[0])].pop();
          const id = last?.closest('[data-id]')?.getAttribute('data-id') || null;
          return { ok: true, messageId: id };
        }
      }
      return { ok: false, code: 'send_failed', message: 'O WhatsApp Web não confirmou o envio' };
    }
    await sleep(700);
  }
  return { ok: false, code: 'timeout', message: 'Conversa não abriu a tempo' };
}

browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'status') return Promise.resolve({ status: status() });
  if (msg.type === 'sendPrefilled') return sendPrefilled(msg.text, msg.timeoutMs || 45000);
  return undefined;
});
