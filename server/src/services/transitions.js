// State machines for lost reports, found reports and claims. Invalid transitions are rejected on the server.
import { HttpError } from '../lib/errors.js';

export const LOST_TRANSITIONS = {
  open: ['resolved', 'withdrawn'],
  withdrawn: ['open'],
  resolved: [],
};
export const FOUND_TRANSITIONS = {
  reported: ['under_review', 'stored', 'archived'],
  under_review: ['reported', 'stored', 'archived'],
  stored: ['under_review', 'claim_pending', 'archived'],
  claim_pending: ['stored', 'returned'],
  returned: ['archived'],
  archived: [],
};
// 'claim_pending' and 'returned' are only ever set by the claim workflow, never by hand.
export const FOUND_SYSTEM_ONLY = new Set(['claim_pending', 'returned']);
export const CLAIM_TRANSITIONS = {
  submitted: ['under_review', 'rejected', 'withdrawn'],
  under_review: ['info_requested', 'approved', 'rejected', 'withdrawn'],
  info_requested: ['under_review', 'rejected', 'withdrawn'],
  approved: ['completed', 'rejected', 'withdrawn'],
  rejected: [],
  withdrawn: [],
  completed: [],
};
export const ACTIVE_CLAIM = ['submitted', 'under_review', 'info_requested', 'approved'];
export const CLAIMABLE_FOUND = ['reported', 'under_review', 'stored', 'claim_pending'];

const TABLES = { lost: LOST_TRANSITIONS, found: FOUND_TRANSITIONS, claim: CLAIM_TRANSITIONS };

export function canTransition(kind, from, to) {
  return (TABLES[kind][from] || []).includes(to);
}
export function assertTransition(kind, from, to) {
  if (!canTransition(kind, from, to)) {
    throw new HttpError(409, `Cannot change status from "${from}" to "${to}"`);
  }
}
