import { describe, it, expect } from 'vitest';
import { duration, clock, parseDuration, percent, filterQuery } from '../src/lib/analytics';
describe('indicadores: valores ausentes, tempo e filtros', () => {
  it('distingue tempo zero de tempo ainda não calculado e suporta ciclos acima de um dia', () => { expect(duration(0)).toBe('00:00'); expect(duration(null)).toBe('—'); expect(duration(undefined)).toBe('—'); expect(duration(1505)).toBe('25:05'); expect(duration(-1)).toBe('—'); expect(duration(NaN)).toBe('—'); expect(duration(59.9)).toBe('01:00'); });
  it('valida minutos e permite metas longas sem aceitar datas ou números incompletos', () => { expect(parseDuration('72:30')).toBe(4350); expect(parseDuration('00:00')).toBe(0); for (const invalid of ['12:60', '12', '2026-10-20', '-1:00', '']) expect(parseDuration(invalid)).toBeNull(); });
  it('preserva aderência zero e limites do horário de chegada', () => { expect(percent(0)).toBe('0%'); expect(percent(null)).toBe('—'); expect(clock(1439.8)).toBe('23:59'); expect(clock(undefined)).toBe('—'); });
  it('exporta exatamente os filtros selecionados e codifica destinos com caracteres especiais', () => { const query = filterQuery({ year: '2026', month: '', unitId: 'matriz', type: 'PULL', carrier: '', destination: 'Fábrica A & B', driverId: '', plate: '' }); const params = new URLSearchParams(query); expect(params.get('destination')).toBe('Fábrica A & B'); expect(params.get('unitId')).toBe('matriz'); expect(params.has('month')).toBe(false); });
});
