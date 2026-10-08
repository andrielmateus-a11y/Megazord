// Seleciona o transporte do canal. Um envio usa exatamente um transporte.
import { config } from '../config.js';
import { EvolutionTransport } from '../integrations/whatsapp/EvolutionTransport.js';
import { FirefoxTransport } from '../integrations/whatsapp/FirefoxTransport.js';
import type { WhatsAppTransport } from '../integrations/whatsapp/WhatsAppTransport.js';
import { evolutionClientFor } from './evolutionService.js';

const transports: Record<'firefox' | 'evolution', WhatsAppTransport> = {
  firefox: new FirefoxTransport(config.queue.sendTimeoutMs),
  evolution: new EvolutionTransport(evolutionClientFor),
};

export function getTransport(name: 'firefox' | 'evolution'): WhatsAppTransport {
  return transports[name];
}

/** Para testes: substitui um transporte. */
export function setTransport(name: 'firefox' | 'evolution', t: WhatsAppTransport) {
  transports[name] = t;
}
