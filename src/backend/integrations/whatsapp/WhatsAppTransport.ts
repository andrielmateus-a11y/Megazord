// Camada de abstração de transporte. Cada canal usa UM transporte por envio — nunca os dois.
//   WhatsAppTransport
//     ├── EvolutionTransport  (API/servidor)
//     └── FirefoxTransport    (WhatsApp Web no Firefox Container do canal)
import type { ChannelRow } from '../../repositories/channelRepository.js';

export interface SendRequest {
  accountId: number;
  channel: ChannelRow;
  phone: string;
  text: string;
}

export interface SendResult {
  externalId: string | null;
  containerName: string | null;
  bridgeResponse?: unknown;
}

export class TransportError extends Error {
  constructor(
    public userMessage: string,
    /** Pode tentar novamente mais tarde? */
    public retryable: boolean,
    /** O problema é do canal (não do contato)? Se sim, o canal é marcado com erro. */
    public channelProblem: boolean,
    technical?: string,
  ) {
    super(technical ?? userMessage);
  }
}

export interface WhatsAppTransport {
  readonly name: 'firefox' | 'evolution';
  send(req: SendRequest): Promise<SendResult>;
}
