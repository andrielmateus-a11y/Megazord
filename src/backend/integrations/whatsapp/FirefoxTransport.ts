import { BridgeError, bridgeHub } from '../firefox/bridgeHub.js';
import { TransportError, type SendRequest, type SendResult, type WhatsAppTransport } from './WhatsAppTransport.js';

export class FirefoxTransport implements WhatsAppTransport {
  readonly name = 'firefox' as const;

  constructor(private timeoutMs = 60000) {}

  async send({ accountId, channel, phone, text }: SendRequest): Promise<SendResult> {
    const container = channel.container;
    if (!container?.cookieStoreId) {
      throw new TransportError('Container do Firefox não encontrado para este canal.', false, true, 'no cookieStoreId');
    }
    try {
      const data = await bridgeHub.command(
        accountId,
        'wa.send',
        { cookieStoreId: container.cookieStoreId, containerName: container.name, phone, text },
        this.timeoutMs,
      );
      return { externalId: data?.messageId ?? null, containerName: container.name, bridgeResponse: data };
    } catch (err) {
      if (err instanceof BridgeError) {
        const contactProblem = err.code === 'invalid_number';
        throw new TransportError(err.userMessage, err.code === 'timeout' || err.code === 'bridge_offline', !contactProblem, `${err.code}: ${err.message}`);
      }
      throw new TransportError('Falha inesperada no Firefox Bridge.', true, true, (err as Error).message);
    }
  }
}
