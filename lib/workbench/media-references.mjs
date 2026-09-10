// Image IDs are bare SHA-256 values stored under media/, never output IDs.
// A pattern remains a real dependency when its model is in another branch or
// a retained historical version, even when it is not in the media library.
export function projectPatternMediaIds(project) {
  const values = [project.craftAsset?.texture?.imageFileId,
    ...Object.values(project.variants || {}).map(branch => branch.craftAsset?.texture?.imageFileId),
    ...(project.flow?.records || []).filter(record => record.target === 'craftAsset').map(record => record.value?.texture?.imageFileId)];
  return [...new Set(values.filter(value => value !== undefined))];
}

export function projectMediaIds(project) {
  return [...new Set([...(project.assets || []).map(asset => asset.fileId), ...projectPatternMediaIds(project)].filter(value => value !== undefined))];
}
