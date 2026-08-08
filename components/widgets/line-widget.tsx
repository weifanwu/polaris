import type { WidgetSpec } from "@/types";
import { InteractiveChart } from "./chart-loader";

export function LineWidget({ widget }: { widget: WidgetSpec }) {
  return <InteractiveChart widget={widget} type="line" />;
}
