import * as React from "react";

/** Hairline surface container with optional header. */
export interface CardProps extends React.HTMLAttributes<HTMLElement>{
  children?:React.ReactNode;
  title?:React.ReactNode;
  /** mono-caps meta text on the right of the header */
  meta?:React.ReactNode;
  tone?:"neutral"|"cool"|"warm"|"risk";
  /** chamfered corners instead of radius */
  faceted?:boolean;
  padding?:string;
}
export declare function Card(props:CardProps):JSX.Element;
