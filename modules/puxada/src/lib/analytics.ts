export const metricKeys = ['tmvOut', 'factory', 'tmvReturn', 'unit', 'cycle'] as const;
export type MetricKey = typeof metricKeys[number];
export const metricLabels: Record<MetricKey, string> = { tmvOut: 'TMV de ida', factory: 'TMA na fábrica', tmvReturn: 'TMV de volta', unit: 'TMA na revenda', cycle: 'Ciclo completo' };
export const metricDescriptions: Record<MetricKey, string> = { tmvOut: 'Da saída da revenda à chegada à fábrica.', factory: 'Da chegada à saída da fábrica.', tmvReturn: 'Da saída da fábrica à chegada à revenda.', unit: 'Da chegada à revenda à próxima saída, com os ajustes registrados.', cycle: 'Da saída à próxima saída, com os ajustes registrados. Na transferência, do início ao fim.' };
export const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
export interface Metric { count: number; missingCount: number; notApplicableCount: number; averageMinutes?: number; targetMinutes?: number; adherenceTargetPercent: number; within?: number; above?: number; adherencePercent?: number; destinationCount: number; plateCount: number }
export type Metrics = Record<MetricKey, Metric>;
export interface Group { key: string; label: string; total: number; tripIds: string[]; metrics: Metrics }
export interface Month { month: number; total: number; completed: number; metrics: Metrics }
export interface ArrivalSummary { count: number; medianMinute?: number; firstMinute?: number; lastMinute?: number; peakHours: number[]; bins: { hour: number; count: number }[] }
export interface Arrival { summary: ArrivalSummary; groups: { key: string; label: string; type?: string; summary: ArrivalSummary }[] }
export interface Filters { year: string; month: string; unitId: string; type: string; carrier: string; destination: string; driverId: string; plate: string }
export interface AnalyticsTrip { id: string; code: string; unitName: string; type: string; plate: string; destination: string; carrier: string; driver1Name: string; driver2Name?: string; startedAt?: string; endedAt?: string; metrics: Record<MetricKey, number | null> }
export interface Report { generatedAt: string; options: { years: number[]; units: { value: string; label: string }[]; carriers: string[]; destinations: string[]; drivers: { value: string; label: string }[]; plates: string[] }; goal: Record<string, number>; overview: { total: number; completed: number; inProgress: number; historicalOpen: number; other: number; averageCycleMinutes?: number; factoryArrivals: number; unitArrivals: number; topDestinations: Group[] }; metrics: Metrics; monthly: Month[]; breakdowns: { destination: Group[]; plate: Group[]; driver: Group[]; day: Group[] }; arrivals: { factory: Arrival; unit: Arrival }; trips: AnalyticsTrip[] }
export const duration = (minutes?: number | null) => minutes == null || !Number.isFinite(minutes) || minutes < 0 ? '—' : `${Math.floor(Math.round(minutes) / 60).toString().padStart(2, '0')}:${(Math.round(minutes) % 60).toString().padStart(2, '0')}`;
export const clock = (minute?: number | null) => minute == null ? '—' : duration(Math.min(1439, Math.round(minute)));
export const percent = (value?: number | null) => value == null || !Number.isFinite(value) ? '—' : `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value)}%`;
export function parseDuration(value: string): number | null { if (!/^\d{1,4}:[0-5]\d$/.test(value)) return null; const [h, m] = value.split(':').map(Number); return h * 60 + m; }
export const filterQuery = (f: Filters) => new URLSearchParams(Object.entries(f).filter(([, v]) => v !== '')).toString();
export const goalFields: Record<MetricKey, [string, string]> = { tmvOut: ['tmvOutTargetMinutes', 'tmvOutAdherence'], factory: ['factoryTargetMinutes', 'factoryAdherence'], tmvReturn: ['tmvReturnTargetMinutes', 'tmvReturnAdherence'], unit: ['unitTargetMinutes', 'unitAdherence'], cycle: ['cycleTargetMinutes', 'cycleAdherence'] };
