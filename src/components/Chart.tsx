import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export default function Chart({ data }: { data: any[] }) {
  const chartData = useMemo(() => {
    // group by day
    const grouped: any = {};
    data.forEach(d => {
      const date = new Date(d.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      if (!grouped[date]) grouped[date] = 0;
      grouped[date] += (d.duration / 60); // minutes
    });
    
    // Convert to array and sort latest 7 days
    const results = Object.keys(grouped).map(date => ({ date, duration: Math.round(grouped[date]) }));
    return results.reverse().slice(0, 7);
  }, [data]);

  if (chartData.length === 0) {
    return <div className="h-full flex items-center justify-center text-sm text-gray-400">No data to display</div>;
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
        <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6B7280' }} dy={10} />
        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6B7280' }} />
        <Tooltip 
          cursor={{ fill: '#F3F4F6' }}
          contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' }}
        />
        <Bar dataKey="duration" fill="#3B82F6" radius={[4, 4, 0, 0]} name="Minutes" />
      </BarChart>
    </ResponsiveContainer>
  );
}
