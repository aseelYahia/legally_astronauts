import { describe, expect, it } from "vitest";
import type { Alert } from "./safety";
import { groupBySeverity, WARNING_ICONS, warningInfo, warningType } from "./warningCatalog";

const a = (id: string, severity: Alert["severity"] = "caution", at?: [number, number]): Alert => ({ id, severity, title: id, why: "", source: "", at });

describe("warningCatalog", () => {
  it("maps every alert id produced by safety/eva/team to a known type", () => {
    const ids: [string, string][] = [
      ["steep", "steep"], ["moderate", "steep"], ["near-limit", "slope-limit"], ["distance", "long-route"], ["gain", "climb"],
      ["difficulty", "effort"], ["resolution", "data-resolution"], ["weather", "archived-weather"], ["no-route", "no-route"],
      ["eva-time", "eva-time"], ["eva-reserve", "eva-time"], ["eva-o2", "oxygen"], ["eva-o2-reserve", "oxygen"], ["eva-power", "power"],
      ["eva-power-reserve", "power"], ["A-steep", "steep"], ["B-eva-o2", "oxygen"], ["A-return", "no-route"], ["team-A", "no-route"],
      ["team-wait", "rendezvous"], ["team-o2", "oxygen"], ["team-power", "power"],
    ];
    for (const [id, type] of ids) expect(warningType(id), id).toBe(type);
    expect(warningType("something-new")).toBe("other");
  });

  it("keeps severity and position from the alert, never re-grading it", () => {
    const w = warningInfo(a("A-steep", "warning", [77.4, 18.4]));
    expect(w).toMatchObject({ severityLabel: "Warning", locational: true, astronaut: "A", label: "Steep terrain" });
    expect(warningInfo(a("distance", "info")).severityLabel).toBe("Info");
    expect(warningInfo(a("team-B", "warning")).astronaut).toBe("B");
    expect(warningInfo(a("gain")).locational).toBe(false);
  });

  it("has an icon for every type and groups without dropping alerts", () => {
    const all = ["steep", "near-limit", "distance", "gain", "difficulty", "resolution", "weather", "no-route", "eva-time", "eva-o2", "eva-power", "team-wait", "x"];
    for (const id of all) expect(WARNING_ICONS[warningInfo(a(id)).icon].length).toBeGreaterThan(0);
    const list = [a("1", "info"), a("2", "warning"), a("3", "caution"), a("4", "warning")];
    const g = groupBySeverity(list);
    expect(g.map((x) => x.severity)).toEqual(["warning", "caution", "info"]);
    expect(g.flatMap((x) => x.alerts)).toHaveLength(list.length);
  });
});
