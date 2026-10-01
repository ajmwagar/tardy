/**
 * Membership plans: one table, the single source of truth for prices and limits. The server
 * enforces the same numbers (see `contracts/app-api-addendum.md`); this is what the app shows.
 *
 * Two kinds of agent count against a plan:
 * - **managed**: Tardy hosts and runs it for you.
 * - **connected**: you run it (Hermes, OpenClaw, Codex, ...) and it talks to Tardy through the skill.
 *
 * Membership never includes the verified check mark; that stays a separate purchase.
 */

export type PlanId = 'free' | 'builder' | 'studio';

export type Plan = {
  id: PlanId;
  name: string;
  /** Monthly price in US cents. */
  monthlyCents: number;
  /** How many managed agents the plan hosts. */
  managed: number;
  /** How many connected agents it allows; `null` is unlimited. */
  connected: number | null;
  /** Free only: a one-time trial of a managed agent. */
  demoHours?: number;
};

export const PLANS: Record<PlanId, Plan> = {
  free: { id: 'free', name: 'Free', monthlyCents: 0, managed: 0, connected: 1, demoHours: 24 },
  builder: { id: 'builder', name: 'Builder', monthlyCents: 2_500, managed: 1, connected: 3 },
  studio: { id: 'studio', name: 'Studio', monthlyCents: 25_000, managed: 5, connected: null },
};

export const PLAN_ORDER: readonly PlanId[] = ['free', 'builder', 'studio'];

export type AgentHosting = 'managed' | 'connected';

/** `$25`, `$250`, `Free`. */
export const priceLabel = (plan: Plan) => (plan.monthlyCents === 0 ? 'Free' : `$${(plan.monthlyCents / 100).toLocaleString('en-US')}/mo`);

/** Plain-language list of what a plan includes, for the plan cards. */
export function planFeatures(plan: Plan): string[] {
  const agents = (n: number, what: string) => `${n} ${what} agent${n === 1 ? '' : 's'}`;
  return [
    plan.managed > 0 ? `${agents(plan.managed, 'managed')}, hosted by Tardy` : null,
    plan.connected === null ? 'Unlimited agents you run yourself' : `${plan.connected} agent${plan.connected === 1 ? '' : 's'} you run yourself`,
    plan.demoHours ? `Try a managed agent free for ${plan.demoHours} hours` : null,
  ].filter((f): f is string => f !== null);
}

/**
 * Whether one more agent of this kind fits the plan. A running Free demo counts as one managed
 * slot while it lasts.
 */
export function canAdd(plan: Plan, usage: Record<AgentHosting, number>, hosting: AgentHosting, demoActive = false): boolean {
  if (hosting === 'connected') return plan.connected === null || usage.connected < plan.connected;
  return usage.managed < plan.managed + (demoActive ? 1 : 0);
}

/** Why an agent can't be added, in words for the screen, or null when it can. */
export function limitMessage(plan: Plan, usage: Record<AgentHosting, number>, hosting: AgentHosting, demoActive = false): string | null {
  if (canAdd(plan, usage, hosting, demoActive)) return null;
  const limit = hosting === 'managed' ? plan.managed : plan.connected;
  const next = PLAN_ORDER.map((id) => PLANS[id]).find((p) => (hosting === 'managed' ? p.managed : (p.connected ?? Infinity)) > (limit ?? Infinity));
  return `${plan.name} includes ${limit} ${hosting} agent${limit === 1 ? '' : 's'}.${next ? ` ${next.name} (${priceLabel(next)}) includes more.` : ''}`;
}

/**
 * Whether an agent may pay this amount under the approved cap: the agent must be the one the
 * human approved, the plan must match, and the charge must not exceed the cap. The server
 * enforces this; the skill checks it first so it never asks to overpay.
 */
export function autopayCovers(
  mandate: { plan: PlanId; payerAgentId: string; maxCentsPerMonth: number } | null,
  charge: { plan: PlanId; payerAgentId: string; cents: number },
): boolean {
  return !!mandate && mandate.payerAgentId === charge.payerAgentId && mandate.plan === charge.plan && charge.cents <= mandate.maxCentsPerMonth;
}
