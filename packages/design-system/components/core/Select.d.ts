import * as React from "react";

/** Compact select styled as a hairline control. */
export interface SelectOption { value: string; label: string }
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: (SelectOption | string)[];
  size?: "sm" | "md";
  /** mono-caps label rendered to the left */
  label?: string;
}
export declare function Select(props: SelectProps): JSX.Element;
