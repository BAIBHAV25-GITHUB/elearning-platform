import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoney } from '../../utils/format';
import { truncate } from '../../utils/analytics';

const INDIGO = '#4f46e5';
const EMERALD = '#10b981';
const SLATE = '#cbd5e1';
const ROSE = '#f43f5e';

function ChartBox({ label, height = 280, empty, children }) {
  if (empty) return <p className="py-10 text-center text-sm italic text-slate-400">Nothing to chart yet.</p>;
  // role=img + label gives screen readers a summary; the table next to each chart carries the exact data
  return (
    <div role="img" aria-label={label} style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
    </div>
  );
}

export function RevenueChart({ data }) {
  return (
    <ChartBox label="Bar chart of revenue per course" empty={!data.length} height={Math.max(220, data.length * 44)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tickFormatter={(v) => formatMoney(v)} />
        <YAxis type="category" dataKey="name" width={140} tickFormatter={(v) => truncate(v)} />
        <Tooltip formatter={(v) => formatMoney(v)} />
        <Bar dataKey="revenue" name="Revenue" fill={EMERALD} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ChartBox>
  );
}

export function SeatsChart({ data }) {
  return (
    <ChartBox label="Stacked bar chart of taken and free seats per batch" empty={!data.length} height={Math.max(220, data.length * 44)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" allowDecimals={false} />
        <YAxis type="category" dataKey="name" width={160} tickFormatter={(v) => truncate(v, 26)} />
        <Tooltip />
        <Legend />
        <Bar dataKey="taken" name="Taken" stackId="s" fill={INDIGO} />
        <Bar dataKey="free" name="Free" stackId="s" fill={SLATE} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ChartBox>
  );
}

export function CompletionChart({ data }) {
  return (
    <ChartBox label="Bar chart of how many students are in each completion band" empty={!data.some((d) => d.students)}>
      <BarChart data={data} margin={{ right: 16 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="name" />
        <YAxis allowDecimals={false} />
        <Tooltip />
        <Bar dataKey="students" name="Students" fill={INDIGO} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartBox>
  );
}

/** Net revenue per month, with the refunded part stacked on top (net + refunded = gross). */
export function RevenueTimelineChart({ data }) {
  return (
    <ChartBox label="Stacked bar chart of net and refunded revenue per month" empty={!data.some((d) => d.gross || d.refunded)}>
      <BarChart data={data} margin={{ right: 16 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" />
        <YAxis tickFormatter={(v) => formatMoney(v)} width={72} />
        <Tooltip formatter={(v) => formatMoney(v)} />
        <Legend />
        <Bar dataKey="net" name="Net revenue" stackId="r" fill={EMERALD} />
        <Bar dataKey="refunded" name="Refunded" stackId="r" fill={ROSE} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartBox>
  );
}

export function EnrollmentsTimelineChart({ data }) {
  return (
    <ChartBox label="Line chart of new enrollments per month" empty={!data.some((d) => d.enrollments)} height={240}>
      <LineChart data={data} margin={{ right: 16 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" />
        <YAxis allowDecimals={false} />
        <Tooltip />
        <Line type="monotone" dataKey="enrollments" name="Enrollments" stroke={INDIGO} strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ChartBox>
  );
}
