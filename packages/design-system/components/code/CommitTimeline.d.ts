import * as React from "react";

/**
 * Commit scrubber: bar height = churn, colour = temperature.
 * @startingPoint section="Code" subtitle="Commit scrubber with churn bars" viewport="700x120"
 */
export interface TimelineCommit{
  sha?:string;
  message?:string;
  /** lines changed — drives bar height */
  churn?:number;
  /** 0..7 temperature */
  temp?:number;
}
export interface CommitTimelineProps{
  commits:TimelineCommit[];
  /** selected index */
  value?:number;
  onChange?:(index:number)=>void;
  height?:number;
  style?:React.CSSProperties;
}
export declare function CommitTimeline(props:CommitTimelineProps):JSX.Element;
