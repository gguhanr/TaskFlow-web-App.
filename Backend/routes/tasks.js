const mongoose = require('mongoose');
const express = require('express');
const router = express.Router();
const Task = require('../models/Task');
const User = require('../models/User');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// Attach a denormalized ownerName so the frontend never has to join itself.
// Tasks created before accounts existed may have no valid userId at all —
// those are labeled "Unassigned" instead of being sent to MongoDB, which
// would throw a CastError and take down the whole request.
async function withOwnerNames(tasks) {
  const ids = [...new Set(
    tasks
      .map((t) => String(t.userId))
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
  )];
  const users = ids.length ? await User.find({ _id: { $in: ids } }).select('name') : [];
  const nameById = {};
  users.forEach((u) => { nameById[String(u._id)] = u.name; });
  return tasks.map((t) => {
    const obj = t.toObject();
    obj.ownerName = nameById[String(t.userId)] || 'Unassigned';
    return obj;
  });
}

router.get('/', async (req, res) => {
  try {
    const scopeAll = req.query.scope === 'all' && req.user.role === 'admin';
    const filter = scopeAll ? {} : { userId: req.user._id };
    const tasks = await Task.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: await withOwnerNames(tasks) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const body = { ...req.body };
    let ownerId = req.user._id;

    // Only an admin may assign a task to someone other than themselves.
    if (req.user.role === 'admin' && body.assigneeId) {
      if (!mongoose.Types.ObjectId.isValid(body.assigneeId)) {
        return res.status(400).json({ success: false, error: 'Assignee not found' });
      }
      const target = await User.findById(body.assigneeId);
      if (!target) return res.status(400).json({ success: false, error: 'Assignee not found' });
      ownerId = target._id;
    }
    delete body.assigneeId;

    const task = new Task({ ...body, userId: ownerId });
    await task.save();
    const [withName] = await withOwnerNames([task]);
    res.status(201).json({ success: true, data: withName });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
    if (req.user.role !== 'admin' && String(task.userId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, error: 'You can only view your own tasks' });
    }
    const [withName] = await withOwnerNames([task]);
    res.json({ success: true, data: withName });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
    if (req.user.role !== 'admin' && String(task.userId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, error: 'You can only edit your own tasks' });
    }

    const body = { ...req.body };
    if (req.user.role === 'admin' && body.assigneeId && mongoose.Types.ObjectId.isValid(body.assigneeId)) {
      const target = await User.findById(body.assigneeId);
      if (target) task.userId = target._id;
    }
    delete body.assigneeId;

    Object.assign(task, body);
    task.updatedAt = Date.now();
    await task.save();
    const [withName] = await withOwnerNames([task]);
    res.json({ success: true, data: withName });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.patch('/:id/status', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
    if (req.user.role !== 'admin' && String(task.userId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, error: 'You can only update your own tasks' });
    }
    task.status = req.body.status;
    task.updatedAt = Date.now();
    await task.save();
    const [withName] = await withOwnerNames([task]);
    res.json({ success: true, data: withName });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/clear-completed', async (req, res) => {
  try {
    const r = await Task.deleteMany({ userId: req.user._id, status: 'done' });
    res.json({ success: true, data: { removed: r.deletedCount } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
    if (req.user.role !== 'admin' && String(task.userId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, error: 'You can only delete your own tasks' });
    }
    await task.deleteOne();
    res.json({ success: true, message: 'Task deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
