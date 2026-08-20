import { GITHUB_NEW_ISSUE_URL } from '../../constants/github';

export type FeedbackType = 'bug' | 'feature' | 'general';

export interface FeedbackPayload {
  type: FeedbackType;
  title: string;
  message: string;
  contact?: string;
}

const TYPE_LABELS: Record<FeedbackType, string> = {
  bug: 'Bug report',
  feature: 'Feature request',
  general: 'General feedback',
};

const TITLE_PREFIX: Record<FeedbackType, string> = {
  bug: '[Bug]',
  feature: '[Feature]',
  general: '[Feedback]',
};

function collectDiagnostics(): string {
  const lines = [
    `- **Page:** ${typeof window !== 'undefined' ? window.location.href : 'unknown'}`,
    `- **Browser:** ${typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'}`,
    `- **Language:** ${typeof navigator !== 'undefined' ? navigator.language : 'unknown'}`,
    `- **Submitted:** ${new Date().toISOString()}`,
  ];

  if (typeof screen !== 'undefined') {
    lines.push(`- **Screen:** ${screen.width}×${screen.height}`);
  }

  return lines.join('\n');
}

function buildIssueBody(payload: FeedbackPayload): string {
  const contact = payload.contact?.trim() || '_Not provided_';

  return [
    `**Type:** ${TYPE_LABELS[payload.type]}`,
    '',
    '## Description',
    payload.message.trim(),
    '',
    '## Contact',
    contact,
    '',
    '---',
    '_Submitted from [JustCropIt](https://github.com/deziikuoo/JustCropIt)_',
    '',
    '### Diagnostics',
    collectDiagnostics(),
  ].join('\n');
}

/**
 * Build a GitHub "new issue" URL with pre-filled title and body.
 * The user completes submission on GitHub (sign-in required).
 */
export function buildGitHubIssueUrl(payload: FeedbackPayload): string {
  const trimmedTitle = payload.title.trim().slice(0, 200);
  const prefixedTitle = `${TITLE_PREFIX[payload.type]} ${trimmedTitle}`;

  let body = buildIssueBody({
    ...payload,
    title: trimmedTitle,
    message: payload.message.trim(),
  });

  // Browsers enforce practical URL length limits; trim message if needed.
  const maxUrlLength = 7500;
  let params = new URLSearchParams({
    title: prefixedTitle,
    body,
  });
  let url = `${GITHUB_NEW_ISSUE_URL}?${params.toString()}`;

  if (url.length > maxUrlLength) {
    const overhead = url.length - body.length;
    const maxBody = Math.max(500, maxUrlLength - overhead - 80);
    body = `${body.slice(0, maxBody).trim()}\n\n_(Message truncated for URL length.)_`;
    params = new URLSearchParams({ title: prefixedTitle, body });
    url = `${GITHUB_NEW_ISSUE_URL}?${params.toString()}`;
  }

  return url;
}

export function openGitHubIssue(payload: FeedbackPayload): Window | null {
  const url = buildGitHubIssueUrl(payload);
  return window.open(url, '_blank', 'noopener,noreferrer');
}
