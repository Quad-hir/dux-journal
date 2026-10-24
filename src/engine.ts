/**
 * The Dux Journal — core trading journal algorithm
 * Manual-first, fixed-starting-balance risk, six qualifying closed-trade test.
 * This module is intentionally independent of any UI or broker API.
 */

export type Direction = "LONG" | "SHORT";
export type OrderType = "MARKET" | "LIMIT" | "STOP";
export type TradeStatus =
  | "PLANNED"
  | "VALIDATED"
  | "PENDING"
  | "OPEN"
  | "CLOSED"
  | "CANCELLED"
  | "EXPIRED"
  | "REVIEW_REQUIRED";
export type CloseReason =
  | "TAKE_PROFIT"
  | "STOP_LOSS"
  | "MANUAL_PROFIT"
  | "MANUAL_LOSS"
  | "STRATEGY_INVALIDATION"
  | "TRAILING_STOP"
  | "TIME_EXIT"
  | "OTHER";
export type Outcome = "WIN" | "LOSS" | "BREAKEVEN";

export interface Account {
  id: string;
  currency: string;
  startingBalance: number;
  /** This experiment uses a fixed risk base: the original starting balance. */
  riskBase: number;
  createdAt: string;
}

export interface Checklist {
  strategyConfirmed: boolean;
  entryConfirmation: boolean;
  validInvalidationLevel: boolean;
  positionSizeCalculated: boolean;
  newsAndSessionChecked: boolean;
  exitPlanSaved: boolean;
  riskIsAffordable: boolean;
}

export interface Trade {
  id: string;
  cycleId: string;
  pair: string;
  direction: Direction;
  orderType: OrderType;
  timeframe: string;
  setupDate: string;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  plannedRiskCash: number;
  /** Planned volume/units are recorded by the trader; sizing is instrument-specific. */
  positionSize?: number;
  rationale: string;
  screenshotRef?: string;
  checklist: Checklist;
  status: TradeStatus;
  violations: string[];
  plannedRR?: number;
  placedAt?: string;
  triggeredAt?: string;
  fillPrice?: number;
  filledQuantity?: number;
  exitAt?: string;
  exitPrice?: number;
  closeReason?: CloseReason;
  grossPnL?: number;
  costs?: number;
  netPnL?: number;
  actualInitialRiskCash?: number;
  realisedR?: number;
  outcome?: Outcome;
  qualifiesForTest: boolean;
  alreadyCounted: boolean;
  reviewRequired: boolean;
  events: TradeEvent[];
}

export interface TradeEvent {
  at: string;
  type: string;
  note?: string;
  fromStatus?: TradeStatus;
  toStatus?: TradeStatus;
  data?: Record<string, unknown>;
}

export interface Rules {
  riskPercent: number;
  targetRR: number;
  rrTolerance: number;
  requiredClosedTrades: number;
  requireChecklist: boolean;
}

export interface Cycle {
  id: string;
  startedAt: string;
  status: "ACTIVE" | "REVIEW_REQUIRED" | "REVIEWED";
  qualifyingClosedTrades: number;
  qualifyingTradeIds: string[];
  reviewedAt?: string;
  reviewNotes?: string;
}

export interface DailyJournal {
  date: string; // YYYY-MM-DD in the user's local timezone
  startingRealisedBalance: number;
  endingRealisedBalance?: number;
  realisedPnL: number;
  floatingPnLAtSnapshot: number;
  setupsIdentified: number;
  qualifyingSetups: number;
  tradesTaken: number;
  missedSetups: number;
  ruleViolations: number;
  emotionsBefore?: string;
  emotionsDuring?: string;
  emotionsAfter?: string;
  missedSetupNotes?: string;
  lessonsLearned?: string;
  nextSessionPlan?: string;
  snapshotAt: string;
}

export const DEFAULT_RULES: Rules = {
  riskPercent: 1,
  targetRR: 3,
  rrTolerance: 0.02,
  requiredClosedTrades: 6,
  requireChecklist: true,
};

const REQUIRED_CHECKLIST: (keyof Checklist)[] = [
  "strategyConfirmed",
  "entryConfirmation",
  "validInvalidationLevel",
  "positionSizeCalculated",
  "newsAndSessionChecked",
  "exitPlanSaved",
  "riskIsAffordable",
];

export function createAccount(currency: string, startingBalance: number, now = new Date().toISOString()): Account {
  if (!Number.isFinite(startingBalance) || startingBalance <= 0) {
    throw new Error("Starting balance must be a positive number.");
  }
  return {
    id: makeId("acct"),
    currency,
    startingBalance,
    riskBase: startingBalance,
    createdAt: now,
  };
}

export function createCycle(now = new Date().toISOString()): Cycle {
  return {
    id: makeId("cycle"),
    startedAt: now,
    status: "ACTIVE",
    qualifyingClosedTrades: 0,
    qualifyingTradeIds: [],
  };
}

export function calculatePlannedRR(trade: Pick<Trade, "direction" | "entry" | "stopLoss" | "takeProfit">): number {
  const risk = trade.direction === "LONG" ? trade.entry - trade.stopLoss : trade.stopLoss - trade.entry;
  const reward = trade.direction === "LONG" ? trade.takeProfit - trade.entry : trade.entry - trade.takeProfit;
  if (risk <= 0 || reward <= 0) return Number.NaN;
  return reward / risk;
}

export function validateTrade(trade: Trade, account: Account, rules: Rules = DEFAULT_RULES): string[] {
  const errors: string[] = [];
  if (!trade.pair?.trim()) errors.push("Select a trading pair.");
  if (trade.direction !== "LONG" && trade.direction !== "SHORT") errors.push("Select LONG or SHORT.");
  if (!Number.isFinite(trade.entry) || !Number.isFinite(trade.stopLoss) || !Number.isFinite(trade.takeProfit)) {
    errors.push("Entry, stop loss and take profit must be valid numbers.");
    return errors;
  }
  if (trade.entry <= 0 || trade.stopLoss <= 0 || trade.takeProfit <= 0) errors.push("Price levels must be positive.");

  if (trade.direction === "LONG" && !(trade.stopLoss < trade.entry && trade.entry < trade.takeProfit)) {
    errors.push("For LONG, price levels must satisfy SL < entry < TP.");
  }
  if (trade.direction === "SHORT" && !(trade.takeProfit < trade.entry && trade.entry < trade.stopLoss)) {
    errors.push("For SHORT, price levels must satisfy TP < entry < SL.");
  }

  const maxRisk = account.riskBase * (rules.riskPercent / 100);
  if (!Number.isFinite(trade.plannedRiskCash) || trade.plannedRiskCash <= 0) {
    errors.push("Planned cash risk must be greater than zero.");
  } else if (trade.plannedRiskCash > maxRisk + 1e-8) {
    errors.push(`Risk exceeds the ${rules.riskPercent}% fixed-base cap (${maxRisk.toFixed(2)} ${account.currency}).`);
  }

  const rr = calculatePlannedRR(trade);
  if (!Number.isFinite(rr)) {
    errors.push("Cannot calculate RR: check the entry, stop loss and take profit.");
  } else if (rr < rules.targetRR - 1e-9) {
    errors.push(`This is 1:${rr.toFixed(2)} RR, below the minimum 1:${rules.targetRR} required for the test.`);
  }

  if (!trade.rationale?.trim()) errors.push("Add your setup rationale.");
  if (rules.requireChecklist) {
    for (const item of REQUIRED_CHECKLIST) {
      if (!trade.checklist[item]) errors.push(`Checklist incomplete: ${checklistLabel(item)}.`);
    }
  }
  return errors;
}

/** Creates a planned record. The caller supplies the ID and cycle for persistence. */
export function prepareTrade(input: Omit<Trade, "status" | "violations" | "plannedRR" | "qualifiesForTest" | "alreadyCounted" | "reviewRequired" | "events">, account: Account, rules: Rules = DEFAULT_RULES, now = new Date().toISOString()): Trade {
  const trade: Trade = {
    ...input,
    status: "PLANNED",
    violations: [],
    plannedRR: calculatePlannedRR(input),
    qualifiesForTest: false,
    alreadyCounted: false,
    reviewRequired: false,
    events: [{ at: now, type: "TRADE_CREATED", toStatus: "PLANNED" }],
  };
  trade.violations = validateTrade(trade, account, rules);
  return trade;
}

export function validateAndApprove(trade: Trade, account: Account, rules: Rules = DEFAULT_RULES, now = new Date().toISOString()): Trade {
  assertStatus(trade, ["PLANNED", "REVIEW_REQUIRED"]);
  const violations = validateTrade(trade, account, rules);
  const previous = trade.status;
  trade.violations = violations;
  trade.plannedRR = calculatePlannedRR(trade);
  trade.qualifiesForTest = violations.length === 0;
  trade.status = violations.length === 0 ? "VALIDATED" : "REVIEW_REQUIRED";
  trade.reviewRequired = violations.length > 0;
  trade.events.push({ at: now, type: "VALIDATION", fromStatus: previous, toStatus: trade.status, data: { violations } });
  return trade;
}

export function placeOrder(trade: Trade, now = new Date().toISOString()): Trade {
  assertStatus(trade, ["VALIDATED"]);
  if (trade.violations.length) throw new Error("Cannot place an order with validation violations.");
  const previous = trade.status;
  trade.placedAt = now;
  trade.status = trade.orderType === "MARKET" ? "OPEN" : "PENDING";
  if (trade.orderType === "MARKET") {
    // Manual mode: the user must enter a confirmed fill price/time using recordFill().
    trade.status = "PENDING";
  }
  trade.events.push({ at: now, type: "ORDER_PLACED", fromStatus: previous, toStatus: trade.status });
  return trade;
}

/** Manual tracking requires an explicit fill confirmation; a price touching entry is not proof of a fill. */
export function recordFill(trade: Trade, fill: { price: number; quantity: number; at?: string; actualInitialRiskCash: number }, account?: Account, rules: Rules = DEFAULT_RULES): Trade {
  assertStatus(trade, ["PENDING", "OPEN"]);
  if (![fill.price, fill.quantity, fill.actualInitialRiskCash].every(Number.isFinite) || fill.price <= 0 || fill.quantity <= 0 || fill.actualInitialRiskCash <= 0) {
    throw new Error("Fill price, quantity and actual initial cash risk must be positive valid numbers.");
  }
  const at = fill.at ?? new Date().toISOString();
  const previous = trade.status;
  // This v1 manual workflow records one confirmed fill. Partial-fill aggregation is reserved for a later version.
  trade.fillPrice = fill.price;
  trade.filledQuantity = fill.quantity;
  trade.actualInitialRiskCash = fill.actualInitialRiskCash;
  trade.triggeredAt = at;
  trade.status = "OPEN";
  if (account && fill.actualInitialRiskCash > account.riskBase * (rules.riskPercent / 100) + 1e-8) {
    const message = `Actual initial risk exceeds the ${rules.riskPercent}% fixed-base cap (${(account.riskBase * rules.riskPercent / 100).toFixed(2)} ${account.currency}).`;
    if (!trade.violations.includes(message)) trade.violations.push(message);
    trade.qualifiesForTest = false;
    trade.reviewRequired = true;
  }
  trade.events.push({ at, type: "FILL_CONFIRMED", fromStatus: previous, toStatus: "OPEN", data: { ...fill, actualRiskCapBreached: Boolean(account && fill.actualInitialRiskCash > account.riskBase * (rules.riskPercent / 100) + 1e-8) } });
  return trade;
}

export function recordFloatingPnL(trade: Trade, netFloatingPnL: number, at = new Date().toISOString()): Trade {
  assertStatus(trade, ["OPEN"]);
  if (!Number.isFinite(netFloatingPnL)) throw new Error("Floating P/L must be a valid number.");
  trade.events.push({ at, type: "FLOATING_PNL_SNAPSHOT", data: { netFloatingPnL } });
  return trade;
}

export function closeTrade(trade: Trade, close: {
  exitPrice: number;
  grossPnL: number;
  costs: number;
  reason: CloseReason;
  at?: string;
  note?: string;
}, now = new Date().toISOString()): Trade {
  assertStatus(trade, ["OPEN"]);
  if (![close.exitPrice, close.grossPnL, close.costs].every(Number.isFinite) || close.exitPrice <= 0 || close.costs < 0) {
    throw new Error("Exit price and P/L must be valid; costs cannot be negative.");
  }
  if (!trade.actualInitialRiskCash || trade.actualInitialRiskCash <= 0) {
    throw new Error("Record the confirmed fill and actual initial cash risk before closing the trade.");
  }
  const at = close.at ?? now;
  const previous = trade.status;
  trade.exitAt = at;
  trade.exitPrice = close.exitPrice;
  trade.closeReason = close.reason;
  trade.grossPnL = close.grossPnL;
  trade.costs = close.costs;
  trade.netPnL = close.grossPnL - close.costs;
  trade.realisedR = trade.netPnL / trade.actualInitialRiskCash;
  trade.outcome = trade.netPnL > 0 ? "WIN" : trade.netPnL < 0 ? "LOSS" : "BREAKEVEN";
  trade.status = "CLOSED";
  trade.reviewRequired = true;
  trade.events.push({ at, type: "TRADE_CLOSED", fromStatus: previous, toStatus: "CLOSED", note: close.note, data: { ...close, netPnL: trade.netPnL, realisedR: trade.realisedR, outcome: trade.outcome } });
  return trade;
}

export function cancelOrExpire(trade: Trade, action: "CANCELLED" | "EXPIRED", note?: string, now = new Date().toISOString()): Trade {
  assertStatus(trade, ["PENDING", "VALIDATED"]);
  const previous = trade.status;
  trade.status = action;
  trade.events.push({ at: now, type: action, fromStatus: previous, toStatus: action, note });
  // An unfilled/cancelled order is never counted as a completed trade.
  trade.qualifiesForTest = false;
  return trade;
}

/** Call once when a closed trade is reviewed; duplicate calls cannot double-count it. */
export function countClosedTrade(cycle: Cycle, trade: Trade, now = new Date().toISOString()): Cycle {
  if (trade.status !== "CLOSED") throw new Error("Only closed trades can count toward the test.");
  if (trade.alreadyCounted) return cycle;
  if (cycle.status !== "ACTIVE") {
    trade.events.push({ at: now, type: "NOT_COUNTED_CYCLE_REQUIRES_REVIEW", note: "Trade closed while the previous six-trade cycle was awaiting review; it remains in the account ledger but was not added to that cycle." });
    trade.alreadyCounted = true;
    return cycle;
  }
  if (!trade.qualifiesForTest || trade.violations.length > 0) {
    trade.alreadyCounted = true;
    trade.reviewRequired = true;
    trade.events.push({ at: now, type: "NOT_COUNTED_FOR_TEST", note: "Trade did not qualify under the configured test rules." });
    return cycle;
  }
  cycle.qualifyingTradeIds.push(trade.id);
  cycle.qualifyingClosedTrades = cycle.qualifyingTradeIds.length;
  trade.alreadyCounted = true;
  trade.events.push({ at: now, type: "COUNTED_IN_CYCLE", data: { cycleId: cycle.id, count: cycle.qualifyingClosedTrades } });
  if (cycle.qualifyingClosedTrades >= DEFAULT_RULES.requiredClosedTrades) cycle.status = "REVIEW_REQUIRED";
  return cycle;
}

export function reviewCycle(cycle: Cycle, notes: string, now = new Date().toISOString()): Cycle {
  if (cycle.status !== "REVIEW_REQUIRED") throw new Error("The cycle must reach review before it can be marked reviewed.");
  if (!notes.trim()) throw new Error("Add review notes before completing the cycle review.");
  cycle.status = "REVIEWED";
  cycle.reviewNotes = notes;
  cycle.reviewedAt = now;
  return cycle;
}

export interface AccountSnapshot {
  startingBalance: number;
  realisedBalance: number;
  netRealisedPnL: number;
  floatingPnL: number;
  equity: number;
  realisedReturnPct: number;
  equityReturnPct: number;
  peakEquity: number;
  drawdownPct: number;
}

export function calculateAccountSnapshot(account: Account, trades: Trade[], floatingPnLByTrade: Record<string, number> = {}, peakEquity?: number): AccountSnapshot {
  const closed = trades.filter(t => t.status === "CLOSED");
  const netRealisedPnL = closed.reduce((sum, t) => sum + (t.netPnL ?? 0), 0);
  const floatingPnL = trades.filter(t => t.status === "OPEN").reduce((sum, t) => sum + (floatingPnLByTrade[t.id] ?? 0), 0);
  const realisedBalance = account.startingBalance + netRealisedPnL;
  const equity = realisedBalance + floatingPnL;
  const peak = Math.max(peakEquity ?? account.startingBalance, equity);
  return {
    startingBalance: account.startingBalance,
    realisedBalance,
    netRealisedPnL,
    floatingPnL,
    equity,
    realisedReturnPct: ((realisedBalance - account.startingBalance) / account.startingBalance) * 100,
    equityReturnPct: ((equity - account.startingBalance) / account.startingBalance) * 100,
    peakEquity: peak,
    drawdownPct: peak > 0 ? ((peak - equity) / peak) * 100 : 0,
  };
}

export function calculatePerformance(trades: Trade[]) {
  const closed = trades.filter(t => t.status === "CLOSED");
  const wins = closed.filter(t => (t.netPnL ?? 0) > 0).length;
  const losses = closed.filter(t => (t.netPnL ?? 0) < 0).length;
  const totalR = closed.reduce((sum, t) => sum + (t.realisedR ?? 0), 0);
  const assessed = trades.filter(t => t.status !== "PLANNED");
  const compliant = assessed.filter(t => t.violations.length === 0 && t.qualifiesForTest).length;
  return {
    closedTrades: closed.length,
    wins,
    losses,
    breakevens: closed.length - wins - losses,
    winRatePct: closed.length ? (wins / closed.length) * 100 : 0,
    totalNetPnL: closed.reduce((sum, t) => sum + (t.netPnL ?? 0), 0),
    totalR,
    expectancyR: closed.length ? totalR / closed.length : 0,
    assessedTrades: assessed.length,
    compliantTrades: compliant,
    ruleCompliancePct: assessed.length ? (compliant / assessed.length) * 100 : 0,
  };
}

export function createDailyJournal(input: Omit<DailyJournal, "snapshotAt">, now = new Date().toISOString()): DailyJournal {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error("Date must use YYYY-MM-DD format.");
  return { ...input, snapshotAt: now };
}

export function feedbackForClosedTrade(trade: Trade): string {
  if (trade.status !== "CLOSED") return "This trade has not closed yet.";
  if (trade.closeReason === "TAKE_PROFIT") {
    return `Congratulations — your target was reached. Your net result is ${formatSigned(trade.netPnL ?? 0)} (${formatSigned(trade.realisedR ?? 0)}R). Review execution and keep risk consistent.`;
  }
  if (trade.closeReason === "STOP_LOSS") {
    return "Your stop was hit. If you followed your plan, this was controlled risk, not a failure. Review the setup and your execution; never increase risk to recover a loss.";
  }
  return "Your trade is closed. Record why you exited and whether it matched your exit rules. A profitable manual exit can still break a rule, and a losing exit can sometimes be appropriate risk management.";
}

function assertStatus(trade: Trade, allowed: TradeStatus[]): void {
  if (!allowed.includes(trade.status)) throw new Error(`Action not allowed while trade status is ${trade.status}.`);
}
function checklistLabel(item: keyof Checklist): string {
  const labels: Record<keyof Checklist, string> = {
    strategyConfirmed: "setup matches written strategy",
    entryConfirmation: "entry confirmation occurred",
    validInvalidationLevel: "stop loss is at a valid invalidation level",
    positionSizeCalculated: "position size and cash risk calculated",
    newsAndSessionChecked: "news/session restrictions checked",
    exitPlanSaved: "exit plan saved",
    riskIsAffordable: "risk is affordable",
  };
  return labels[item];
}
function formatSigned(value: number): string { return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`; }
function makeId(prefix: string): string { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
