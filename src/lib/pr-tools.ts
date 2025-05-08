import { Octokit } from '@octokit/rest';
import { DiffItem } from './pr-filters';

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

export interface PRTools {
  relatedIssues: string[];
  contributors: {
    name: string;
    avatar: string;
    contributions: number;
  }[];
}

export async function getPRTools(pr: DiffItem): Promise<PRTools> {
  const [owner, repo] = pr.url.split('/').slice(-4, -2);
  const prNumber = parseInt(pr.id);

  try {
    // Get related issues
    const { data: issues } = await octokit.issues.listForRepo({
      owner,
      repo,
      state: 'all',
      labels: 'enhancement,bug,feature',
    });

    // Filter issues that were closed around the same time as the PR
    const relatedIssues = issues
      .filter(issue => {
        const issueNumber = issue.number;
        return issueNumber !== prNumber && // Exclude the PR itself
          issue.closed_at && // Only consider closed issues
          Math.abs(new Date(issue.closed_at).getTime() - new Date().getTime()) < 7 * 24 * 60 * 60 * 1000; // Within 7 days
      })
      .map(issue => issue.title || '')
      .filter(title => title !== '')
      .slice(0, 3); // Limit to 3 related issues

    // Get contributor information
    const { data: contributors } = await octokit.repos.listContributors({
      owner,
      repo,
    });

    const topContributors = contributors
      .filter(contributor => contributor.login && contributor.avatar_url)
      .map(contributor => ({
        name: contributor.login as string,
        avatar: contributor.avatar_url as string,
        contributions: contributor.contributions,
      }))
      .sort((a, b) => b.contributions - a.contributions)
      .slice(0, 3); // Get top 3 contributors

    return {
      relatedIssues,
      contributors: topContributors,
    };
  } catch (error) {
    console.error('Error fetching PR tools:', error);
    return {
      relatedIssues: [],
      contributors: [],
    };
  }
} 