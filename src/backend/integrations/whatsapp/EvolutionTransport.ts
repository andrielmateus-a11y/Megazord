import { IntegrationError } from '../../lib/errors.js';
import type { EvolutionClient } from '../evolution/EvolutionClient.js';
import { TransportError, type SendRequest, type SendResult, type WhatsAppTransport } from './WhatsAppTransport.js';

export class EvolutionTransport implements WhatsAppTransport {
  readonly name = 'evolution' as const;

  constructor(private clientFor: (accountId: number) => Promise<EvolutionClient>) {}

  async send({ accountId, channel, phone, text }: SendRequest): Promise<SendResult> {
    if (!channel.evolutionInstance) {
      throw new TransportError('Canal sem instância da Evolution API.', false, true);
    }
    const client = await this.clientFor(accountId);
    try {
      const { externalId } = await client.sendText(channel.evolutionInstance, phone, text);
      return { externalId, containerName: null };
    } catch (err) {
      if (err instanceof IntegrationError) {
        const contactProblem = /não possui WhatsApp/.test(err.userMessage);
        throw new TransportError(err.userMessage, err.retryable, !contactProblem, err.technical);
      }
      throw new TransportError('Falha inesperada na Evolution API.', true, true, (err as Error).message);
    }
  }
}
