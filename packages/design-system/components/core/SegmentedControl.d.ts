import * as React from "react";

/**
 * Mode switcher for canvas views and skins.
 * @startingPoint section="Core" subtitle="Mode switcher: graph / diff / timeline" viewport="700x120"
 */
export interface SegmentedOption { value: string; label?: string; icon?: string }
export interface SegmentedControlProps {
  value: string;
  onChange?: (value: string) => void;
  options: (SegmentedOption | string)[];
  size?: "sm" | "md";
  style?: React.CSSProperties;
}
export declare function SegmentedControl(props: SegmentedControlProps): JSX.Element;
