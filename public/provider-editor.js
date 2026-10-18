/** Keep empty display-name columns, or efforts would be mistaken for a name. */
export function formatProviderModels(models) {
  return (models || []).map(model => [
    model.id,
    model.displayName === model.id ? '' : model.displayName || '',
    (model.efforts || []).join(','),
  ].join(' | ')).join('\n');
}

export function parseProviderModels(text, previousModels = []) {
  const models = [];
  for (const line of String(text || '').split(/\n+/)) {
    if (!line.trim()) continue;
    const parts = line.split('|').map(part => part.trim());
    const [id, displayName, effortText] = parts;
    if (!id) throw new Error('Model lines need an id');
    if (parts.length > 3) throw new Error('Model lines have too many columns');
    const previous = previousModels.find(model => model.id === id);
    const efforts = effortText ? effortText.split(',').map(item => item.trim()).filter(Boolean) : previous?.efforts;
    models.push({
      ...previous,
      id,
      displayName: displayName || id,
      efforts,
      defaultReasoningEffort: previous?.defaultReasoningEffort && efforts?.includes(previous.defaultReasoningEffort)
        ? previous.defaultReasoningEffort : undefined,
    });
  }
  if (!models.length) throw new Error('Add at least one model');
  return models;
}

export function matchingProviderPreset(presets, provider) {
  return (presets || []).find(preset => preset.provider.id === provider?.id
    && preset.provider.baseUrl === provider?.baseUrl);
}
