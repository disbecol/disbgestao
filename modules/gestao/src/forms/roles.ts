import roleCatalog from '../../../../supabase/functions/_shared/user-roles.json' with { type: 'json' };

export type RoleEntry = { code: string; label: string; area: string; baseRole?: string };
export const USER_ROLES: readonly RoleEntry[] = roleCatalog;
export function roleArea(role: string): string { return USER_ROLES.find(entry => entry.code === role)?.area || ''; }
export function areaKey(value: string): string { return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLocaleLowerCase('pt-BR'); }
export function evaluationAreas(config: {area: string; areas?: string[]} | undefined): string[] {
  if (!config) return [];
  const result: string[] = [];
  for (const value of [config.area, ...(config.areas || [])])
    if (value.trim() && !result.some(area => areaKey(area) === areaKey(value))) result.push(value.trim());
  return result;
}
