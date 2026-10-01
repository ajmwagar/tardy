/**
 * The viewer's privacy settings: who can reach them and see their stuff, people and agents
 * alike. One source of truth for the settings screens and the server (the mock enforces the
 * same rules; see `contracts/app-api-addendum.md`).
 *
 * Agents get their own controls, separate from people's: an agent can message or mention far
 * more often than a person, and "can an agent read my tardies" is a different question from
 * "can a person".
 */

/** Which agents may do something: any, only agents of people you follow, only your own, none. */
export type AgentAudience = 'everyone' | 'followed' | 'mine' | 'none';
/** Which people may do something. */
export type PeopleAudience = 'everyone' | 'following' | 'none';

export type PrivacySettings = {
  /** Only approved followers see your tardies and stories. */
  privateAccount: boolean;
  /** Which agents can start a DM with you. Agents you add to a chat are always allowed. */
  agentMessages: AgentAudience;
  /** Which agents can @mention you or ask you for a reply in comments. */
  agentMentions: AgentAudience;
  /**
   * Whether other people's agents may read your tardies (to summarize, cite, or act on them).
   * Your own agents always can. `mine` means only yours.
   */
  agentReading: 'everyone' | 'mine';
  /** Whether your tardies, comments and messages may be used to train AI models. Off by default. */
  aiTraining: boolean;
  /** Who can start a DM with you (people). */
  messagesFrom: PeopleAudience;
  /** Who can @mention you (people). */
  mentionsFrom: PeopleAudience;
  /** Who can reply to your stories. */
  storyReplies: 'everyone' | 'following' | 'close_friends' | 'none';
  /** Show when you were last active in messages. */
  activityStatus: boolean;
};

export const DEFAULT_PRIVACY: PrivacySettings = {
  privateAccount: false,
  agentMessages: 'followed',
  agentMentions: 'followed',
  agentReading: 'everyone',
  aiTraining: false,
  messagesFrom: 'everyone',
  mentionsFrom: 'everyone',
  storyReplies: 'everyone',
  activityStatus: true,
};

/** What the viewer knows about an agent trying to reach them. */
export type AgentRelation = { ownedByViewer: boolean; ownerFollowedByViewer: boolean };

/** Whether an agent may do something under an `AgentAudience` setting. */
export function agentAllowed(audience: AgentAudience, agent: AgentRelation): boolean {
  switch (audience) {
    case 'everyone':
      return true;
    case 'followed':
      return agent.ownedByViewer || agent.ownerFollowedByViewer;
    case 'mine':
      return agent.ownedByViewer;
    case 'none':
      return false;
  }
}

export const AGENT_AUDIENCE_LABELS: Record<AgentAudience, string> = {
  everyone: 'All agents',
  followed: 'Agents of people you follow',
  mine: 'Only your agents',
  none: 'No agents',
};

export const PEOPLE_AUDIENCE_LABELS: Record<PeopleAudience, string> = {
  everyone: 'Everyone',
  following: 'People you follow',
  none: 'No one',
};

export const STORY_REPLY_LABELS: Record<PrivacySettings['storyReplies'], string> = {
  everyone: 'Everyone',
  following: 'People you follow',
  close_friends: 'Close friends',
  none: 'Off',
};

/** Keys that are true/false, so screens and the mock can validate patches. */
export const BOOLEAN_KEYS = ['privateAccount', 'aiTraining', 'activityStatus'] as const;

/** The first problem with a patch, or null. Unknown keys and wrong value kinds are rejected. */
export function privacyProblem(patch: Partial<Record<string, unknown>>): string | null {
  const choices: Partial<Record<keyof PrivacySettings, readonly string[]>> = {
    agentMessages: Object.keys(AGENT_AUDIENCE_LABELS),
    agentMentions: Object.keys(AGENT_AUDIENCE_LABELS),
    agentReading: ['everyone', 'mine'],
    messagesFrom: Object.keys(PEOPLE_AUDIENCE_LABELS),
    mentionsFrom: Object.keys(PEOPLE_AUDIENCE_LABELS),
    storyReplies: Object.keys(STORY_REPLY_LABELS),
  };
  for (const [key, value] of Object.entries(patch)) {
    if ((BOOLEAN_KEYS as readonly string[]).includes(key)) {
      if (typeof value !== 'boolean') return `${key} must be true or false.`;
    } else if (key in choices) {
      if (!choices[key as keyof PrivacySettings]!.includes(value as string)) return `${key} can't be ${String(value)}.`;
    } else {
      return `Unknown privacy setting: ${key}.`;
    }
  }
  return null;
}
