"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

export type TrendPoint = { date: string; pv: number; uv: number; ip_count: number };

export default function TrendChart({ data }: { data: TrendPoint[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    chartRef.current = echarts.init(ref.current);
    const onResize = () => chartRef.current?.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chartRef.current?.dispose();
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setOption({
      tooltip: { trigger: "axis" },
      legend: { data: ["PV", "UV", "IP"], textStyle: { color: "#9ca3af" }, top: 0, right: 0 },
      grid: { left: 48, right: 24, top: 44, bottom: 32 },
      xAxis: {
        type: "category",
        data: data.map((d) => d.date.slice(5)),
        axisLine: { lineStyle: { color: "#374151" } },
        axisLabel: { color: "#9ca3af" },
      },
      yAxis: {
        type: "value",
        splitLine: { lineStyle: { color: "#1f2937" } },
        axisLabel: { color: "#9ca3af" },
      },
      series: [
        {
          name: "PV",
          type: "line",
          smooth: true,
          symbol: "none",
          data: data.map((d) => d.pv),
          itemStyle: { color: "#60a5fa" },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "rgba(96,165,250,0.25)" },
              { offset: 1, color: "rgba(96,165,250,0)" },
            ]),
          },
        },
        {
          name: "UV",
          type: "line",
          smooth: true,
          symbol: "none",
          data: data.map((d) => d.uv),
          itemStyle: { color: "#34d399" },
        },
        {
          name: "IP",
          type: "line",
          smooth: true,
          symbol: "none",
          data: data.map((d) => d.ip_count),
          itemStyle: { color: "#fbbf24" },
        },
      ],
    });
  }, [data]);

  return <div ref={ref} className="w-full h-80" />;
}
