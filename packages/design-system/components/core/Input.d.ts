import * as React from "react";

/** Hairline text field; monospace variant for paths, SHAs and query syntax. */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Lucide icon name shown at the leading edge */
  icon?: string;
  /** render the value in JetBrains Mono */
  mono?: boolean;
  size?: "sm" | "md" | "lg";
  /** trailing hint, e.g. a shortcut or unit */
  suffix?: React.ReactNode;
  invalid?: boolean;
}
export declare function Input(props: InputProps): JSX.Element;
