import type { AgBaseRegistry, AgDefaultWidgetDefinition, AgWidgetData, AgWidgetDataFormat, AgWidgetFieldReference } from "ag-studio";
import type { AgWidgetDefinition } from "ag-studio-react";

/** Widget registry: Studio's built-in widgets plus our custom "Rule decisions" flow widget. */
export type DecisionFlowData = AgWidgetData<
  { decision: AgWidgetFieldReference[]; outcome: AgWidgetFieldReference[]; payout: AgWidgetFieldReference[]; count: AgWidgetFieldReference[] },
  AgWidgetDataFormat<unknown>
> & { type: "decision-flow" };
export type DecisionFlowDefinition = AgWidgetDefinition<"decision-flow", DecisionFlowData>;

export interface AllowanceRegistry extends AgBaseRegistry {
  widgets: readonly (AgDefaultWidgetDefinition | DecisionFlowDefinition)[];
}
