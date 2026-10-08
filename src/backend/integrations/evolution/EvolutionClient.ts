// Cliente HTTP da Evolution API (v2, compatível com v1 nas leituras).
// Responsável por instâncias, QR Code, status, sincronização, envio e configuração de webhooks.
import { IntegrationError } from '../../lib/errors.js';
import { fetchWithTimeout, readJson } from '../../lib/http.js';
import { normalizePhone } from '../../../shared/text.js';

const PROVIDER = 'Evolution API';

export interface EvolutionInstanceInfo {
  name: string;
  state: 'open' | 'connecting' | 'close' | string;
  ownerJid: string | null;
  phone: string | null;
  profileName: string | null;
}

export function phoneFromJid(jid: string | null | undefined): string | null {
  if (!jid) return null;
  return normalizePhone(String(jid).split('@')[0].split(':')[0]);
}

export function parseInstances(data: any): EvolutionInstanceInfo[] {
  const list = Array.isArray(data) ? data : Array.isArray(data?.instances) ? data.instances : [];
  return list.map((item: any) => {
    const inst = item.instance ?? item;
    const ownerJid = inst.ownerJid ?? inst.owner ?? null;
    return {
      name: String(inst.name ?? inst.instanceName ?? ''),
      state: String(inst.connectionStatus ?? inst.status ?? inst.state ?? 'close'),
      ownerJid,
      phone: phoneFromJid(ownerJid) ?? normalizePhone(inst.number ?? null),
      profileName: inst.profileName ?? null,
    };
  }).filter((i: EvolutionInstanceInfo) => i.name);
}

export class EvolutionClient {
  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {}

  get configured(): boolean {
    return !!this.baseUrl && !!this.apiKey;
  }

  private async call(method: string, path: string, body?: unknown, timeoutMs = 20000): Promise<any> {
    if (!this.configured) {
      throw new IntegrationError(PROVIDER, 'Evolution API não configurada. Informe URL e API Key em Configurações → WhatsApp.', 'not configured', 0, false);
    }
    let res: Response;
    try {
      res = await fetchWithTimeout(`${this.baseUrl}${path}`, {
        method,
        headers: { apikey: this.apiKey, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        timeoutMs,
      });
    } catch (err) {
      throw new IntegrationError(PROVIDER, 'Não foi possível conectar à Evolution API.', (err as Error).message);
    }
    const data = await readJson(res);
    if (!res.ok) {
      const detail = JSON.stringify(data?.response?.message ?? data?.message ?? data ?? '').slice(0, 300);
      if (res.status === 401 || res.status === 403) throw new IntegrationError(PROVIDER, 'API Key da Evolution inválida.', detail, res.status, false);
      if (res.status === 404) throw new IntegrationError(PROVIDER, 'Instância não encontrada na Evolution API.', detail, 404, false);
      if (/not exists|exists on whatsapp|jid/i.test(detail)) throw new IntegrationError(PROVIDER, 'O número não possui WhatsApp.', detail, res.status, false);
      throw new IntegrationError(PROVIDER, 'A Evolution API recusou a operação.', detail, res.status, res.status >= 500);
    }
    return data;
  }

  fetchInstances() {
    return this.call('GET', '/instance/fetchInstances').then(parseInstances);
  }

  createInstance(name: string, webhookUrl: string, events: string[]) {
    return this.call('POST', '/instance/create', {
      instanceName: name,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
      webhook: { url: webhookUrl, byEvents: false, base64: false, events },
    });
  }

  setWebhook(name: string, webhookUrl: string, events: string[]) {
    return this.call('POST', `/webhook/set/${encodeURIComponent(name)}`, {
      webhook: { enabled: true, url: webhookUrl, webhookByEvents: false, webhookBase64: false, events },
    });
  }

  /** Retorna o QR Code (base64 data URL) e/ou pairing code. */
  async connect(name: string): Promise<{ base64: string | null; pairingCode: string | null; code: string | null }> {
    const data = await this.call('GET', `/instance/connect/${encodeURIComponent(name)}`);
    const base64 = data?.base64 ?? data?.qrcode?.base64 ?? null;
    return { base64, pairingCode: data?.pairingCode ?? null, code: data?.code ?? null };
  }

  async connectionState(name: string): Promise<string> {
    const data = await this.call('GET', `/instance/connectionState/${encodeURIComponent(name)}`);
    return String(data?.instance?.state ?? data?.state ?? 'close');
  }

  restart(name: string) {
    return this.call('POST', `/instance/restart/${encodeURIComponent(name)}`).catch((err) => {
      // Algumas versões usam PUT.
      if (err instanceof IntegrationError && err.httpStatus === 404) return this.call('PUT', `/instance/restart/${encodeURIComponent(name)}`);
      throw err;
    });
  }

  logout(name: string) {
    return this.call('DELETE', `/instance/logout/${encodeURIComponent(name)}`);
  }

  deleteInstance(name: string) {
    return this.call('DELETE', `/instance/delete/${encodeURIComponent(name)}`);
  }

  async sendText(name: string, phone: string, text: string): Promise<{ externalId: string | null }> {
    const data = await this.call('POST', `/message/sendText/${encodeURIComponent(name)}`, { number: phone, text }, 45000);
    return { externalId: data?.key?.id ?? data?.messageId ?? null };
  }
}

export const EVOLUTION_EVENTS = [
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  'SEND_MESSAGE',
  'CONNECTION_UPDATE',
  'QRCODE_UPDATED',
];
