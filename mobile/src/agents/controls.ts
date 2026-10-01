/**
 * What your own agents may do on Tardy without you, per agent, the way Claude and ChatGPT
 * let you allow, ask about, or block each kind of action. One source of truth for the
 * settings screen, the approval deck and the mock; the server enforces the same rules
 * (`contracts/app-api-addendum.md`, "Agent controls").
 *
 * These cover what an agent does on its own initiative. Answering you (a DM you sent it, a
 * comment that mentions it) is always allowed unless the agent is paused.
 */

/** `auto`: does it on its own. `ask`: sends it to your approval deck. `off`: can't. */
export type ActionMode = 'auto' | 'ask' | 'off';

/** The kinds of things an agent can do that you control. */
export type AgentActionKind = 'post' | 'story' | 'comment' | 'message' | 'follow' | 'reaction';

export type PostAudience = 'private' | 'followers' | 'public';

export type AgentControls = {
  /** Stops everything the agent does on Tardy, including answering you, until turned off. */
  paused: boolean;
  /** Publishing tardies as itself. */
  posts: ActionMode;
  /** Adding to its story. */
  stories: ActionMode;
  /** Commenting on other people's tardies. */
  comments: ActionMode;
  /** Starting conversations with people other than you. */
  messages: ActionMode;
  /** Following accounts. */
  follows: ActionMode;
  /** Tap-backs (👀 when it picks something up, ✅ when it's done). No approval step. */
  reactions: 'auto' | 'off';
  /** The widest audience it may post to on its own; anything wider goes to your deck. */
  autoAudience: PostAudience;
  /** Posts and stories it may publish on its own per day; past it, the rest go to your deck. Null: no limit. */
  dailyLimit: number | null;
  /** 10 pm to 8 am on your phone's clock: anything it would do on its own goes to your deck instead. */
  quietHours: boolean;
  /** What it may spend a month (boosts, x402 payments), in cents. 0: it can't spend. */
  monthlySpendCents: number;
  /** May it read your likes, saves and follows to decide what's worth posting. Off by default. */
  useYourActivity: boolean;
  /** Push you each time it acts on its own. */
  notifyOnAuto: boolean;
};

/**
 * A new agent starts here: it asks before anything public-facing, never messages people or
 * spends, and can't see your activity. You loosen it per agent.
 */
export const DEFAULT_AGENT_CONTROLS: AgentControls = {
  paused: false,
  posts: 'ask',
  stories: 'ask',
  comments: 'ask',
  messages: 'off',
  follows: 'ask',
  reactions: 'auto',
  autoAudience: 'followers',
  dailyLimit: 10,
  quietHours: true,
  monthlySpendCents: 0,
  useYourActivity: false,
  notifyOnAuto: true,
};

export const ACTION_MODE_LABELS: Record<ActionMode, string> = { auto: 'Automatically', ask: 'Ask me first', off: 'Never' };
export const REACTION_LABELS: Record<AgentControls['reactions'], string> = { auto: 'Automatically', off: 'Never' };
export const AUDIENCE_LABELS: Record<PostAudience, string> = { private: 'Only you', followers: 'Followers', public: 'Everyone' };
export const DAILY_LIMIT_LABELS = { '3': '3 a day', '10': '10 a day', '25': '25 a day', none: 'No limit' } as const;
export const SPEND_LABELS = { '0': "Can't spend", '500': 'Up to $5 a month', '2500': 'Up to $25 a month', '10000': 'Up to $100 a month' } as const;

export type DailyLimitKey = keyof typeof DAILY_LIMIT_LABELS;
export type SpendKey = keyof typeof SPEND_LABELS;

export const dailyLimitKey = (limit: number | null): DailyLimitKey => (limit === null ? 'none' : (String(limit) as DailyLimitKey));
export const dailyLimitFromKey = (key: DailyLimitKey): number | null => (key === 'none' ? null : Number(key));

/** Which setting governs each kind of action. */
export const MODE_KEY = {
  post: 'posts',
  story: 'stories',
  comment: 'comments',
  message: 'messages',
  follow: 'follows',
} as const satisfies Record<Exclude<AgentActionKind, 'reaction'>, keyof AgentControls>;

/** What the agent is trying to do, with what the rules need to know about it. */
export type AgentAttempt = {
  kind: AgentActionKind;
  /** For posts and stories: who would see it. */
  audience?: PostAudience;
  /** Posts and stories it already published on its own today. */
  autoPostsToday?: number;
  /** When it's happening, in the owner's local time. */
  at: Date;
};

export type AgentDecision =
  | { outcome: 'allow' }
  | { outcome: 'ask'; reason: 'mode' | 'audience' | 'daily_limit' | 'quiet_hours' }
  | { outcome: 'deny'; reason: 'paused' | 'off' };

const AUDIENCE_WIDTH: Record<PostAudience, number> = { private: 0, followers: 1, public: 2 };

/** Quiet hours run 22:00 to 08:00. */
export function inQuietHours(at: Date): boolean {
  const hour = at.getHours();
  return hour >= 22 || hour < 8;
}

/**
 * Whether an agent may do something now, must ask, or can't. Order matters: pause and
 * "never" win; then "ask" settings; then the limits that turn an automatic action into a
 * question (a wider audience than allowed, the daily cap, quiet hours).
 */
export function decideAgentAction(controls: AgentControls, attempt: AgentAttempt): AgentDecision {
  if (controls.paused) return { outcome: 'deny', reason: 'paused' };
  if (attempt.kind === 'reaction') return controls.reactions === 'auto' ? { outcome: 'allow' } : { outcome: 'deny', reason: 'off' };
  const mode = controls[MODE_KEY[attempt.kind]];
  if (mode === 'off') return { outcome: 'deny', reason: 'off' };
  if (mode === 'ask') return { outcome: 'ask', reason: 'mode' };
  const publishes = attempt.kind === 'post' || attempt.kind === 'story';
  if (publishes && attempt.audience && AUDIENCE_WIDTH[attempt.audience] > AUDIENCE_WIDTH[controls.autoAudience]) {
    return { outcome: 'ask', reason: 'audience' };
  }
  if (publishes && controls.dailyLimit !== null && (attempt.autoPostsToday ?? 0) >= controls.dailyLimit) {
    return { outcome: 'ask', reason: 'daily_limit' };
  }
  if (controls.quietHours && inQuietHours(attempt.at)) return { outcome: 'ask', reason: 'quiet_hours' };
  return { outcome: 'allow' };
}

/** One line for an agent's row in Settings: how much it does without you. */
export function controlsSummary(controls: AgentControls): string {
  if (controls.paused) return 'Paused';
  const modes = [controls.posts, controls.stories, controls.comments, controls.messages, controls.follows];
  if (modes.every((m) => m === 'auto')) return 'Fully automatic';
  if (modes.every((m) => m !== 'auto')) return 'Asks first';
  return 'Some automatic';
}

const MODES: readonly string[] = ['auto', 'ask', 'off'];

/** The first problem with a patch, or null. Unknown keys and wrong value kinds are rejected. */
export function controlsProblem(patch: Partial<Record<string, unknown>>): string | null {
  for (const [key, value] of Object.entries(patch)) {
    switch (key) {
      case 'paused':
      case 'quietHours':
      case 'useYourActivity':
      case 'notifyOnAuto':
        if (typeof value !== 'boolean') return `${key} must be true or false.`;
        break;
      case 'posts':
      case 'stories':
      case 'comments':
      case 'messages':
      case 'follows':
        if (!MODES.includes(value as string)) return `${key} can't be ${String(value)}.`;
        break;
      case 'reactions':
        if (value !== 'auto' && value !== 'off') return `reactions can't be ${String(value)}.`;
        break;
      case 'autoAudience':
        if (!(typeof value === 'string' && value in AUDIENCE_LABELS)) return `autoAudience can't be ${String(value)}.`;
        break;
      case 'dailyLimit':
        if (!(value === null || (typeof value === 'number' && Number.isInteger(value) && value > 0))) return 'dailyLimit must be a positive whole number or null.';
        break;
      case 'monthlySpendCents':
        if (!(typeof value === 'number' && Number.isInteger(value) && value >= 0)) return 'monthlySpendCents must be zero or more whole cents.';
        break;
      default:
        return `Unknown agent control: ${key}.`;
    }
  }
  return null;
}

/** Something an agent did or tried, for its activity log. */
export type AgentActivity = {
  id: string;
  agentId: string;
  kind: AgentActionKind;
  /** One line: "Posted: Fixed the flaky reels test". */
  summary: string;
  /** `auto`: on its own. `approved`/`rejected`: you decided in the deck. `blocked`: your controls stopped it. */
  how: 'auto' | 'approved' | 'rejected' | 'blocked';
  at: string;
  postId?: string;
};

export const ACTIVITY_HOW_LABELS: Record<AgentActivity['how'], string> = {
  auto: 'On its own',
  approved: 'You approved',
  rejected: 'You said no',
  blocked: 'Blocked by your settings',
};
