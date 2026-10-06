const mongoose = require('mongoose');
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Task = require('../models/Task');
const Settings = require('../models/Settings');
const { authenticate, requireAdmin } = require('../middleware/auth');

// Everything below this line requires a valid admin session.
router.use(authenticate, requireAdmin);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Guards every /users/:id route below from a malformed id crashing the
// request with a raw Mongoose CastError.
router.param('id', (req, res, next, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(404).json({ success: false, error: 'Member not found' });
  }
  next();
});

async function getSettings() {
  let s = await Settings.findOne();
  if (!s) s = await Settings.create({});
  return s;
}

router.get('/settings', async (req, res) => {
  try {
    const s = await getSettings();
    res.json({ success: true, data: { workspaceName: s.workspaceName } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/settings', async (req, res) => {
  try {
    const s = await getSettings();
    if (req.body.workspaceName !== undefined) s.workspaceName = String(req.body.workspaceName).trim() || 'Workspace';
    await s.save();
    res.json({ success: true, data: { workspaceName: s.workspaceName } });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Accounts awaiting admin approval (created via public self-registration).
// Not included in /api/team or elsewhere — they're not real workspace
// members until approved.
router.get('/pending-users', async (req, res) => {
  try {
    const users = await User.find({ approvalStatus: 'pending' }).sort({ createdAt: 1 });
    res.json({ success: true, data: users.map((u) => u.toPublic()) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/users/:id/approve', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: 'Request not found' });
    user.approvalStatus = 'approved';
    await user.save();
    res.json({ success: true, data: user.toPublic() });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Declining removes the pending account outright, freeing the email
// address up in case the person is invited properly later.
router.post('/users/:id/reject', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: 'Request not found' });
    if (user.approvalStatus !== 'pending') {
      return res.status(400).json({ success: false, error: 'This account is not awaiting approval' });
    }
    await user.deleteOne();
    res.json({ success: true, message: 'Request declined' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Admin-created accounts skip the approval queue entirely — the admin
// creating it directly is itself the approval.
router.post('/users', async (req, res) => {
  try {
    const { name, email, password, role, department, title } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Name, email and password are required' });
    }
    if (!EMAIL_RE.test(email)) return res.status(400).json({ success: false, error: 'Enter a valid email address' });
    if (password.length < 6) return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });

    const email2 = email.toLowerCase().trim();
    const existing = await User.findOne({ email: email2 });
    if (existing) return res.status(400).json({ success: false, error: 'An account with this email already exists' });

    const user = new User({
      name: name.trim(),
      email: email2,
      role: role === 'admin' ? 'admin' : 'user',
      department: (department || 'General').trim(),
      title: (title || 'Member').trim(),
      approvalStatus: 'approved'
    });
    await user.setPassword(password);
    await user.save();

    res.status(201).json({ success: true, data: user.toPublic() });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.patch('/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: 'Member not found' });
    const isSelf = String(user._id) === String(req.user._id);

    const { name, department, title, role, active } = req.body;
    if (name !== undefined) user.name = String(name).trim() || user.name;
    if (department !== undefined) user.department = String(department).trim() || 'General';
    if (title !== undefined) user.title = String(title).trim() || 'Member';
    // An admin can't demote or disable themselves through this route —
    // prevents a workspace from accidentally locking out its only admin.
    if (role !== undefined && !isSelf) user.role = role === 'admin' ? 'admin' : 'user';
    if (active !== undefined && !isSelf) user.active = !!active;

    await user.save();
    res.json({ success: true, data: user.toPublic() });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/users/:id/reset-password', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: 'Member not found' });
    const { password } = req.body;
    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    }
    await user.setPassword(password);
    await user.save();
    res.json({ success: true, data: { ok: true } });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: 'Member not found' });
    if (String(user._id) === String(req.user._id)) {
      return res.status(400).json({ success: false, error: 'You cannot remove your own account' });
    }

    const { action, reassignTo } = req.body || {};
    if (action === 'reassign' && reassignTo) {
      const target = await User.findById(reassignTo);
      if (!target) return res.status(400).json({ success: false, error: 'Reassignment target not found' });
      await Task.updateMany({ userId: user._id }, { userId: target._id });
    } else {
      await Task.deleteMany({ userId: user._id });
    }

    await user.deleteOne();
    res.json({ success: true, message: 'Member removed' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/purge-completed', async (req, res) => {
  try {
    const r = await Task.deleteMany({ status: 'done' });
    res.json({ success: true, data: { removed: r.deletedCount } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
