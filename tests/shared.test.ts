import { describe, expect, it } from 'vitest';
import { pickNextChannel, previewRotation } from '../src/shared/rotation';
import { formatPhone, isMobile, isValidCnpj, normalizePhone, renderTemplate, missingVariables } from '../src/shared/text';

const ch = (n: number, available = true) => ({ id: n * 10, orderIndex: n, available });

describe('rodízio sequencial', () => {
  it('4 canais: 1 → 2 → 3 → 4 → 1 → 2 → 3 → 4', () => {
    const list = [1, 2, 3, 4].map((n) => ch(n));
    expect(previewRotation(list, 0, 8).map((c) => c.orderIndex)).toEqual([1, 2, 3, 4, 1, 2, 3, 4]);
  });

  it('5 a 8 canais ampliam o ciclo automaticamente', () => {
    for (const total of [5, 6, 7, 8]) {
      const list = Array.from({ length: total }, (_, i) => ch(i + 1));
      const seq = previewRotation(list, 0, total + 1).map((c) => c.orderIndex);
      expect(seq).toEqual([...Array.from({ length: total }, (_, i) => i + 1), 1]);
    }
  });

  it('pula canal indisponível e volta quando ele retorna', () => {
    const down = [ch(1), ch(2), ch(3, false), ch(4)];
    expect(previewRotation(down, 0, 6).map((c) => c.orderIndex)).toEqual([1, 2, 4, 1, 2, 4]);
    const back = [ch(1), ch(2), ch(3), ch(4)];
    expect(previewRotation(back, 2, 3).map((c) => c.orderIndex)).toEqual([3, 4, 1]);
  });

  it('continua do ponteiro persistido (último = WA 03 → próximo = WA 04)', () => {
    expect(pickNextChannel([1, 2, 3, 4].map((n) => ch(n)), 3)?.orderIndex).toBe(4);
    expect(pickNextChannel([1, 2, 3, 4].map((n) => ch(n)), 4)?.orderIndex).toBe(1);
  });

  it('respeita lacunas de order_index e retorna null sem canais', () => {
    expect(previewRotation([ch(1), ch(3), ch(6)], 3, 3).map((c) => c.orderIndex)).toEqual([6, 1, 3]);
    expect(pickNextChannel([ch(1, false)], 0)).toBeNull();
  });
});

describe('texto', () => {
  it('substitui variáveis da mensagem de ativação', () => {
    const msg = renderTemplate('Olá, {nome}! Tudo bem?\nEstou entrando em contato com a {empresa}. {socio} {telefone}', {
      socio: 'JOÃO DA SILVA',
      empresa: 'ABC CONTABILIDADE LTDA',
      telefone: '5511999999999',
    });
    expect(msg).toBe('Olá, João! Tudo bem?\nEstou entrando em contato com a Abc Contabilidade Ltda. João da Silva (11) 99999-9999');
  });

  it('aponta variáveis sem valor', () => {
    expect(missingVariables('Oi {nome}, {empresa}', { empresa: 'X' })).toEqual(['nome']);
  });

  it('normaliza telefones e detecta celular', () => {
    expect(normalizePhone('(11) 99999-8888')).toBe('5511999998888');
    expect(isMobile('11 99999-8888')).toBe(true);
    expect(isMobile('11 3333-4444')).toBe(false);
    expect(formatPhone('5511999998888')).toBe('(11) 99999-8888');
  });

  it('valida CNPJ', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11.222.333/0001-82')).toBe(false);
  });
});
