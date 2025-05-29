import React from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Bar, ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

export function TrainingVisuals({ trainingData }) {
  if (!trainingData) return null;

  const { sentimentPatterns, interactionPatterns } = trainingData;

  // Format time of day data for the chart
  const timeOfDayData = sentimentPatterns.overall.timeOfDay.map(hour => ({
    hour: `${hour.hour}:00`,
    sentiment: hour.averageSentiment.toFixed(2),
    engagement: hour.averageEngagement.toFixed(2)
  }));

  // Format interaction data for the pie chart
  const interactionData = Object.entries(interactionPatterns).map(([username, data]) => ({
    name: username,
    value: data.stats.totalInteractions,
    sentiment: data.stats.averageSentiment.toFixed(2),
    responseRate: (data.stats.responseRate * 100).toFixed(1)
  })).sort((a, b) => b.value - a.value).slice(0, 5);

  return (
    <div className="training-visuals">
      <h3>Training Insights</h3>
      
      <div className="chart-container">
        <h4>Sentiment & Engagement by Time of Day</h4>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={timeOfDayData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="hour" />
            <YAxis yAxisId="left" />
            <YAxis yAxisId="right" orientation="right" />
            <Tooltip />
            <Legend />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="sentiment"
              stroke="#8884d8"
              name="Sentiment Score"
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="engagement"
              stroke="#82ca9d"
              name="Avg. Engagement"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-container">
        <h4>Top 5 Interactions</h4>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={interactionData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="value" name="Total Interactions" fill="#8884d8" />
            <Bar dataKey="responseRate" name="Response Rate %" fill="#82ca9d" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-container">
        <h4>Sentiment Distribution</h4>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={[
                { name: 'Positive', value: sentimentPatterns.overall.positive || 0 },
                { name: 'Neutral', value: sentimentPatterns.overall.neutral || 0 },
                { name: 'Negative', value: sentimentPatterns.overall.negative || 0 }
              ]}
              cx="50%"
              cy="50%"
              outerRadius={80}
              fill="#8884d8"
              dataKey="value"
              label={({ name, value }) => `${name}: ${value}`}
            >
              {sentimentPatterns.overall.timeOfDay.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="stats-summary">
        <h4>Quick Stats</h4>
        <ul>
          <li>
            Overall Sentiment: {sentimentPatterns.overall.averageSentiment.toFixed(2)}
          </li>
          <li>
            Most Active Hour: {
              sentimentPatterns.overall.timeOfDay.reduce((max, hour) => 
                hour.count > max.count ? hour : max
              ).hour + ':00'
            }
          </li>
          <li>
            Total Interactions: {
              Object.values(interactionPatterns).reduce((sum, data) => 
                sum + data.stats.totalInteractions, 0
              )
            }
          </li>
          <li>
            Average Response Rate: {
              (Object.values(interactionPatterns).reduce((sum, data) => 
                sum + data.stats.responseRate, 0
              ) / Object.keys(interactionPatterns).length * 100).toFixed(1)
            }%
          </li>
        </ul>
      </div>
    </div>
  );
} 