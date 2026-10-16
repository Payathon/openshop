// Bookable slots are computed from the shop's weekly hours on demand, never stored.
// Capacity is shared across all of a shop's booking products: it is how many customers
// can be served at once (e.g. the number of technicians).

// Shops run on Beijing time, which has no daylight saving, so a fixed offset is exact.
const OFFSET = "+08:00";
const MINUTE = 60_000;

export interface WeeklyHours {
  // 0 = Sunday … 6 = Saturday.
  weekday: number;
  // "HH:MM", local time.
  open: string;
  close: string;
}

export interface Interval {
  start: Date;
  end: Date;
}

export interface BookingSchedule {
  weekly: WeeklyHours[];
  capacity: number;
  stepMinutes: number;
  // One-off times the shop is closed, e.g. a day off.
  closures: Interval[];
}

export interface Slot extends Interval {
  remaining: number;
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

export function availableSlots(p: {
  // "YYYY-MM-DD", local date.
  date: string;
  schedule: BookingSchedule;
  durationMinutes: number;
  // Bookings currently holding capacity (paid, or awaiting payment and not yet expired).
  bookings: Interval[];
  now: Date;
}): Slot[] {
  const { schedule } = p;
  const weekday = new Date(`${p.date}T12:00:00${OFFSET}`).getUTCDay();
  const slots: Slot[] = [];
  for (const hours of schedule.weekly.filter((h) => h.weekday === weekday)) {
    const close = new Date(`${p.date}T${hours.close}:00${OFFSET}`);
    for (
      let start = new Date(`${p.date}T${hours.open}:00${OFFSET}`);
      start.getTime() + p.durationMinutes * MINUTE <= close.getTime();
      start = new Date(start.getTime() + schedule.stepMinutes * MINUTE)
    ) {
      const slot = { start, end: new Date(start.getTime() + p.durationMinutes * MINUTE) };
      if (slot.start < p.now) continue;
      if (schedule.closures.some((c) => overlaps(c, slot))) continue;
      // Counts every booking touching the slot, not peak concurrency: conservative, never overbooks.
      const remaining = schedule.capacity - p.bookings.filter((b) => overlaps(b, slot)).length;
      if (remaining > 0) slots.push({ ...slot, remaining });
    }
  }
  return slots;
}
