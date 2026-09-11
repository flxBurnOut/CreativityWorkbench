// Shared by the editor, Runtime and prompt builders. Legacy fields are read only
// as a visible migration draft; new writes keep one authoritative prompt.
export const ART_FIELDS = { direction: '整体视觉方向', material: '造型与材质', palette: '色彩与光线', constraints: '保持与排除' };
export const hasLegacyArt = art => Object.keys(ART_FIELDS).some(key => art?.[key]?.trim());
export function activeArtPrompt(art) {
  if (!hasLegacyArt(art)) return art?.fullPrompt || '';
  return [...Object.entries(ART_FIELDS).filter(([key]) => art[key]?.trim()).map(([key, label]) => `${label}：${art[key]}`),
    art.fullPrompt?.trim() ? `原综合描述：${art.fullPrompt}` : ''].filter(Boolean).join('\n\n');
}
export const artFromPrompt = fullPrompt => ({ direction: '', material: '', palette: '', constraints: '', fullPrompt });
export function updateArtPrompt(current, patch) {
  // A direct fullPrompt write intentionally replaces the entire active prompt.
  if (Object.keys(patch).length === 1 && Object.hasOwn(patch, 'fullPrompt')) return artFromPrompt(patch.fullPrompt);
  // Older clients may still write structured fields. Preserve their text in the
  // same visible prompt instead of retaining a second source of active rules.
  return artFromPrompt(activeArtPrompt({ ...current, ...patch }));
}
