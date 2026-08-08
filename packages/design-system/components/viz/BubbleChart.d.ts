import * as React from "react";

/** One packed circle: a file, module or symbol sized by a count. */
export interface BubbleItem {
  id: string;
  label: string;
  /** drives radius, relative to the largest count across all bands */
  count: number;
  unit?: string;
  /** 0..7 temperature — drives fill/stroke */
  temp?: number;
  /** force the solid-filled treatment regardless of focus */
  filled?: boolean;
}
export interface BubbleBand {
  /** band heading, e.g. "Direct dependencies" */
  label: string;
  /** trailing meta in the band header, e.g. "14 packages" */
  meta?: React.ReactNode;
  items: BubbleItem[];
}
/**
 * Grouped, packed-circle layout — one band per category (e.g. dependency depth), circle size
 * encodes a count, fill encodes the shared temperature scale.
 */
export interface BubbleChartProps {
  bands: BubbleBand[];
  width?: number;
  /** smallest / largest circle radius in px */
  minR?: number;
  maxR?: number;
  /** gap between circles / rows in px */
  gap?: number;
  rowGap?: number;
  /** shared focus state: { id, near[], far[] } from the viz focus model */
  focus?: { id: string | null; near?: string[]; far?: string[]; sticky?: boolean };
  onSelect?: (id: string) => void;
  style?: React.CSSProperties;
}
export declare function BubbleChart(props: BubbleChartProps): JSX.Element;
