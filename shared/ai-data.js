export const aiDataMethods = [
  ['unit-price', 'Unit price (SF / LF / EA)'],
  ['hourly', 'Hourly / crew breakdown'],
  ['mixed', 'Mixed']
];
export const aiDataMethodLabel = value => aiDataMethods.find(([id]) => id === value)?.[1] || 'Not specified';

export const aiDataWorkTypes = [['concrete-pour', 'Concrete pour'], ['demo', 'Demo']];
export const normalizeAiDataWorkTypes = value => aiDataWorkTypes.map(([id]) => id).filter(id => Array.isArray(value) && value.includes(id));
