import { describe, expect, it } from "vitest";
import { availableSlots, type BookingSchedule } from "./availability.ts";

// 2026-10-17 is a Saturday. Shops run on Beijing time (UTC+8).
const SAT = "2026-10-17";
const schedule: BookingSchedule = {
  weekly: [{ weekday: 6, open: "10:00", close: "13:00" }],
  capacity: 1,
  stepMinutes: 30,
  closures: [],
};
const earlyNow = new Date("2026-10-16T00:00:00+08:00");
const hhmm = (d: Date) => d.toLocaleTimeString("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit" });

describe("availableSlots", () => {
  it("steps through opening hours, keeping only slots that end by closing time", () => {
    const slots = availableSlots({ date: SAT, schedule, durationMinutes: 90, bookings: [], now: earlyNow });
    expect(slots.map((s) => hhmm(s.start))).toEqual(["10:00", "10:30", "11:00", "11:30"]);
    expect(hhmm(slots[0]!.end)).toBe("11:30");
    expect(slots[0]!.remaining).toBe(1);
  });

  it("returns nothing on days the shop is closed", () => {
    const fri = "2026-10-16";
    expect(availableSlots({ date: fri, schedule, durationMinutes: 60, bookings: [], now: earlyNow })).toEqual([]);
  });

  it("removes slots that overlap a booking once capacity is used up", () => {
    const booked = { start: new Date(`${SAT}T11:00:00+08:00`), end: new Date(`${SAT}T12:00:00+08:00`) };
    const slots = availableSlots({ date: SAT, schedule, durationMinutes: 60, bookings: [booked], now: earlyNow });
    expect(slots.map((s) => hhmm(s.start))).toEqual(["10:00", "12:00"]);
  });

  it("keeps overlapping slots while capacity remains", () => {
    const booked = { start: new Date(`${SAT}T11:00:00+08:00`), end: new Date(`${SAT}T12:00:00+08:00`) };
    const slots = availableSlots({
      date: SAT,
      schedule: { ...schedule, capacity: 2 },
      durationMinutes: 60,
      bookings: [booked],
      now: earlyNow,
    });
    const at11 = slots.find((s) => hhmm(s.start) === "11:00");
    expect(at11?.remaining).toBe(1);
    expect(slots.find((s) => hhmm(s.start) === "10:00")?.remaining).toBe(2);
  });

  it("skips slots inside a closure such as a day off", () => {
    const closures = [{ start: new Date(`${SAT}T10:00:00+08:00`), end: new Date(`${SAT}T11:00:00+08:00`) }];
    const slots = availableSlots({ date: SAT, schedule: { ...schedule, closures }, durationMinutes: 60, bookings: [], now: earlyNow });
    expect(slots.map((s) => hhmm(s.start))).toEqual(["11:00", "11:30", "12:00"]);
  });

  it("skips slots that have already started", () => {
    const now = new Date(`${SAT}T10:40:00+08:00`);
    const slots = availableSlots({ date: SAT, schedule, durationMinutes: 60, bookings: [], now });
    expect(slots.map((s) => hhmm(s.start))).toEqual(["11:00", "11:30", "12:00"]);
  });
});
