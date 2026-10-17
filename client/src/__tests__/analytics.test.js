import { completionBuckets, monthLabel, monthlyTimeline, revenueByCourse, seatsByBatch, summary, timelineIsEmpty, truncate } from '../utils/analytics';

describe('analytics helpers', () => {
  it('ranks revenue and caps the list', () => {
    const rows = [
      { course_title: 'A', total_revenue: '100', total_enrollments: 1 },
      { course_title: 'B', total_revenue: '900.50', total_enrollments: 3 },
      { course_title: 'C', total_revenue: null },
    ];
    const out = revenueByCourse(rows, 2);
    expect(out.map((r) => r.name)).toEqual(['B', 'A']);
    expect(out[0].revenue).toBe(900.5);
  });

  it('never reports negative free seats or more taken than capacity', () => {
    const [b] = seatsByBatch([{ batch_name: 'X', course_title: 'Y', max_capacity: 5, current_capacity: 9 }]);
    expect(b).toMatchObject({ taken: 5, free: 0, name: 'X · Y' });
  });

  it('buckets completion', () => {
    const rows = [0, 10, 49, 50, 99, 100].map((p) => ({ completion_percentage: p }));
    expect(completionBuckets(rows).map((b) => b.students)).toEqual([1, 2, 2, 1]);
  });

  it('summarises, and copes with empty data', () => {
    expect(summary()).toEqual({ revenue: 0, enrollments: 0, learners: 0, avg: 0, completed: 0 });
    const k = summary({
      courseRevenue: [{ total_revenue: '50', total_enrollments: 2 }],
      studentProgress: [{ completion_percentage: 100 }, { completion_percentage: 50 }],
    });
    expect(k).toEqual({ revenue: 50, enrollments: 2, learners: 2, avg: 75, completed: 1 });
  });

  it('truncates long labels', () => {
    expect(truncate('abcdefghij', 5)).toBe('abcd…');
  });

  it('turns timeline rows into chart points, net = gross - refunded', () => {
    const [a, b] = monthlyTimeline([
      { month: '2026-03', gross_revenue: '1800.00', refunded: '300.00', net_revenue: '1500.00', enrollments: 4 },
      { month: '2026-04', gross_revenue: '100', refunded: '40' }, // no net from the server: derived
    ]);
    expect(a).toMatchObject({ label: 'Mar 26', gross: 1800, refunded: 300, net: 1500, enrollments: 4 });
    expect(b.net).toBe(60);
    expect(monthlyTimeline()).toEqual([]);
  });

  it('labels months without time zone surprises and flags an empty timeline', () => {
    expect(monthLabel('2026-01')).toBe('Jan 26');
    expect(monthLabel('2025-12')).toBe('Dec 25');
    expect(monthLabel('nonsense')).toBe('nonsense');
    expect(timelineIsEmpty(monthlyTimeline([{ month: '2026-01', gross_revenue: '0', refunded: '0', net_revenue: '0', enrollments: 0 }]))).toBe(true);
    expect(timelineIsEmpty(monthlyTimeline([{ month: '2026-01', gross_revenue: '0', refunded: '0', enrollments: 2 }]))).toBe(false);
  });
});
