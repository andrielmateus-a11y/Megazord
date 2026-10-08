// Regra central de rodízio sequencial: 1 → 2 → 3 → 4 → 1 ...
// Canais indisponíveis são pulados temporariamente, sem perder a posição do ponteiro.

export interface RotationCandidate {
  id: number;
  orderIndex: number;
  available: boolean;
}

/**
 * Retorna o próximo canal disponível depois do ponteiro `lastOrderIndex`
 * (o order_index do último canal usado; 0 = nunca enviou).
 */
export function pickNextChannel<T extends RotationCandidate>(
  candidates: T[],
  lastOrderIndex: number,
): T | null {
  const available = candidates
    .filter((c) => c.available)
    .sort((a, b) => a.orderIndex - b.orderIndex);
  if (available.length === 0) return null;
  return available.find((c) => c.orderIndex > lastOrderIndex) ?? available[0];
}

/** Simula os próximos N canais a partir do ponteiro (usado na pré-visualização). */
export function previewRotation<T extends RotationCandidate>(
  candidates: T[],
  lastOrderIndex: number,
  count: number,
): T[] {
  const out: T[] = [];
  let pointer = lastOrderIndex;
  for (let i = 0; i < count; i++) {
    const next = pickNextChannel(candidates, pointer);
    if (!next) break;
    out.push(next);
    pointer = next.orderIndex;
  }
  return out;
}
