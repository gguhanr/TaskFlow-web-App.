const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Task = require('../models/Task');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.get('/', async (req, res) => {
  try {
    // Pending/rejected sign-ups aren't real members yet — they live in the
    // admin's approval queue, not the team directory.
    const users = await User.find({ approvalStatus: 'approved' }).sort({ name: 1 });

    const stats = await Task.aggregate([
      { $group: { _id: { userId: '$userId', status: '$status' }, count: { $sum: 1 } } }
    ]);
    const byUser = {};
    stats.forEach((s) => {
      const uid = String(s._id.userId);
      const bucket = (byUser[uid] = byUser[uid] || { total: 0, done: 0, inProgress: 0, todo: 0 });
      const key = s._id.status === 'in-progress' ? 'inProgress' : s._id.status;
      bucket[key] = (bucket[key] || 0) + s.count;
      bucket.total += s.count;
    });

    const data = users.map((u) => {
      const pub = u.toPublic();
      pub.stats = byUser[String(u._id)] || { total: 0, done: 0, inProgress: 0, todo: 0 };
      return pub;
    });

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
