export interface PRFilter {
  minDiffSize: number;
  excludePatterns: string[];
  minCodeChanges: number;
  excludeLabels: string[];
  includeLabels: string[];
}

export interface DiffItem {
  id: string;
  description: string;
  diff: string;
  url: string;
}

export const DEFAULT_FILTERS: PRFilter = {
  minDiffSize: 10,
  minCodeChanges: 3, // Minimum number of meaningful code changes
  excludePatterns: [
    'docs', 'typos', 'formatting', 'chore', 'style', 'lint',
    'bump', 'update', 'deps', 'dependency', 'version'
  ],
  excludeLabels: [
    'documentation', 'chore', 'style', 'dependencies',
    'maintenance', 'housekeeping'
  ],
  includeLabels: [
    'feature', 'enhancement', 'bugfix', 'fix', 'performance',
    'security', 'refactor'
  ]
};

const isMeaningfulCodeChange = (line: string): boolean => {
  // Skip empty lines, comments, and pure whitespace changes
  if (!line.trim() || line.trim().startsWith('//') || line.trim().startsWith('/*')) {
    return false;
  }
  
  // Skip pure formatting changes (only whitespace differences)
  const strippedLine = line.replace(/\s+/g, '');
  if (strippedLine === '+' || strippedLine === '-') {
    return false;
  }

  return true;
};

const countMeaningfulChanges = (diff: string): number => {
  return diff.split('\n')
    .filter(line => line.startsWith('+') || line.startsWith('-'))
    .filter(isMeaningfulCodeChange)
    .length;
};

export const isRelevantPR = (pr: DiffItem, filter: PRFilter): boolean => {
  // Check if PR title contains excluded patterns
  if (filter.excludePatterns.some(pattern => 
    pr.description.toLowerCase().includes(pattern.toLowerCase())
  )) {
    return false;
  }

  // Check if diff size is significant enough
  const diffLines = pr.diff.split('\n').length;
  if (diffLines < filter.minDiffSize) {
    return false;
  }

  // Count meaningful code changes
  const meaningfulChanges = countMeaningfulChanges(pr.diff);
  if (meaningfulChanges < filter.minCodeChanges) {
    return false;
  }

  // Check if the PR has any excluded labels
  if (filter.excludeLabels.some(label => 
    pr.description.toLowerCase().includes(label.toLowerCase())
  )) {
    return false;
  }

  // If includeLabels is specified, ensure at least one matching label is present
  if (filter.includeLabels.length > 0 && !filter.includeLabels.some(label =>
    pr.description.toLowerCase().includes(label.toLowerCase())
  )) {
    return false;
  }

  return true;
};

export const filterPRs = (prs: DiffItem[], filter: PRFilter): DiffItem[] => {
  return prs
    .filter(pr => isRelevantPR(pr, filter))
    .slice(0, 5); // Limit the number of PRs
}; 