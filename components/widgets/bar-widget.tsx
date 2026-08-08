import type { WidgetSpec } from "@/types";
import { InteractiveChart } from "./chart-loader";

export function BarWidget({ widget }: { widget: WidgetSpec }) {
  return <InteractiveChart widget={widget} type="bar" />;
}
