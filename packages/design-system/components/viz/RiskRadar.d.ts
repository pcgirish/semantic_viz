import * as React from "react";

/**
 * Multi-axis risk breakdown on the shared 0..7 temperature scale — the RiskMeter counterpart
 * for more than one dimension.
 */
export interface RiskRadarProps {
  /** axis labels, in order; defaults to functionality/availability/scalability/performance/security */
  axes?: string[];
  /** one 0..7 value per axis, same order as axes */
  values: number[];
  /** short mono reason lines under the chart (full variant only) */
  reasons?: string[];
  /** overall px size of the chart */
  size?: number;
  /** compact: chart only, no axis labels/list — for a Tray row */
  compact?: boolean;
  style?: React.CSSProperties;
}
export declare function RiskRadar(props: RiskRadarProps): JSX.Element;
