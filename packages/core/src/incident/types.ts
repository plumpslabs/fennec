/**
 * Incident Types — The core domain model for Fennec's Incident Engine.
 *
 * An Incident is a correlated, scored, and explained event that represents
 * something the AI needs to know about. It is the Level 1+ unit of context.
 */

import type { BusEvent } from '../correlation/EventBus.js';

// ─── Incident ────────────────────────────────────────────────────

export type IncidentSeverity = 'critical' | 'error' | 'warning' | 'info';
export type IncidentStatus = 'active' | 'resolved' | 'dismissed';

export interface Incident {
  /** Unique incident ID */
  id: string;

  /** Human-readable title */
  title: string;

  /** Severity level */
  severity: IncidentSeverity;

  /** Current status */
  status: IncidentStatus;

  /** How confident the engine is about this incident (0-1) */
  confidence: number;

  /** The layer where the incident originated */
  layer: 'browser' | 'server' | 'terminal' | 'mobile' | 'network';

  /** Category for grouping similar incidents */
  category:
    | 'authentication'
    | 'network'
    | 'runtime'
    | 'resource'
    | 'configuration'
    | 'performance'
    | 'unknown';

  /** Human-readable root cause explanation */
  rootCause: string;

  /** Suggested fix if available */
  fix: string | null;

  /** Evidence: the events that led to this incident */
  evidence: {
    trigger: BusEvent;
    related: BusEvent[];
  };

  /** Timeline of events leading to the incident */
  timeline: Array<{
    at: number;
    relativeMs: number;
    layer: string;
    event: string;
  }>;

  /** Timestamps */
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;

  /** Tags for grouping/filtering */
  tags: string[];
}

// ─── Incident Store ──────────────────────────────────────────────

export interface IncidentCreateInput {
  title: string;
  severity: IncidentSeverity;
  confidence: number;
  layer: Incident['layer'];
  category: Incident['category'];
  rootCause: string;
  fix?: string | null;
  evidence: { trigger: BusEvent; related: BusEvent[] };
  timeline: Incident['timeline'];
  tags?: string[];
}

// ─── Alert ───────────────────────────────────────────────────────

export interface Alert {
  /** Unique alert ID */
  id: string;

  /** Reference to the incident */
  incidentId: string;

  /** Alert severity */
  severity: IncidentSeverity;

  /** One-line summary for Level 0 pulse */
  summary: string;

  /** When the alert was created */
  createdAt: number;

  /** Whether this alert has been seen by the AI */
  acknowledged: boolean;
}
