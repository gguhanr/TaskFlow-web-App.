const express = require('express');
const router = express.Router();
const Task = require('../models/Task');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

function monthRange(offsetFromNow) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offsetFromNow, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offsetFromNow + 1, 1);
  return { start, end };
}

function countIn(list, start, end, statusFilter) {
  return list.filter((t) => {
    const inRange = t.createdAt >= start && t.createdAt < end;
    return inRange && (!statusFilter || t.status === statusFilter);
  }).length;
}

function pctChange(curr, prev) {
  if (prev === 0) return curr > 0 ? 100 : 0;
  return Math.round(((curr - prev) / prev) * 100);
}

router.get('/', async (req, res) => {
  try {
    // Admins default to the whole workspace; everyone else only ever sees
    // their own tasks, regardless of what scope is requested.
    const scopeMe = req.user.role !== 'admin' || req.query.scope === 'me';
    const filter = scopeMe ? { userId: req.user._id } : {};

    const tasks = await Task.find(filter);
    const counts = { total: tasks.length, done: 0, inProgress: 0, todo: 0 };
    const byPriority = { high: 0, medium: 0, low: 0 };
    const categoryCounts = {};
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const soon = new Date(today.getTime() + 7 * 86400000);
    let overdue = 0, dueSoon = 0;

    tasks.forEach((t) => {
      counts[t.status === 'in-progress' ? 'inProgress' : t.status]++;
      byPriority[t.priority]++;
      categoryCounts[t.category] = (categoryCounts[t.category] || 0) + 1;
      if (t.dueDate && t.status !== 'done') {
        const d = new Date(t.dueDate);
        if (d < today) overdue++;
        else if (d <= soon) dueSoon++;
      }
    });

    const { start: curStart, end: curEnd } = monthRange(0);
    const { start: prevStart, end: prevEnd } = monthRange(-1);
    const changes = {
      total: pctChange(countIn(tasks, curStart, curEnd), countIn(tasks, prevStart, prevEnd)),
      done: pctChange(countIn(tasks, curStart, curEnd, 'done'), countIn(tasks, prevStart, prevEnd, 'done')),
      inProgress: pctChange(countIn(tasks, curStart, curEnd, 'in-progress'), countIn(tasks, prevStart, prevEnd, 'in-progress')),
      todo: pctChange(countIn(tasks, curStart, curEnd, 'todo'), countIn(tasks, prevStart, prevEnd, 'todo'))
    };

    const year = new Date().getFullYear();
    const monthly = Array.from({ length: 12 }, (_, m) => {
      const start = new Date(year, m, 1);
      const end = new Date(year, m + 1, 1);
      const created = tasks.filter((t) => t.createdAt >= start && t.createdAt < end).length;
      const completed = tasks.filter((t) => t.status === 'done' && t.updatedAt >= start && t.updatedAt < end).length;
      return { month: m, created, completed };
    });

    const categories = Object.entries(categoryCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    const completionRate = counts.total ? Math.round((counts.done / counts.total) * 100) : 0;

    res.json({
      success: true,
      data: {
        scope: scopeMe ? 'me' : 'workspace',
        counts,
        changes,
        completionRate,
        monthly,
        byPriority,
        categories,
        overdue,
        dueSoon
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
