const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const User = require('../models/User');
const Settings = require('../models/Settings');
const { authenticate } = require('../middleware/auth');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function getSettings() {
  let s = await Settings.findOne();
  if (!s) s = await Settings.create({});
  return s;
}

function sign(user) {
  return jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

// Tells the login screen whether this is a brand-new workspace (first
// account created becomes admin, and is approved immediately).
router.get('/config', async (req, res) => {
  try {
    const userCount = await User.countDocuments();
    const settings = await getSettings();
    res.json({
      success: true,
      data: {
        firstRun: userCount === 0,
        workspaceName: settings.workspaceName
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Self-registration is always open, but only ever creates a *pending*
// account (except the very first one, which bootstraps the workspace
// admin and is approved immediately). A pending account can't log in until
// an admin approves it from the Admin Panel — see POST /api/admin/users/:id/approve.
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Name, email and password are required' });
    }
    if (!EMAIL_RE.test(email)) return res.status(400).json({ success: false, error: 'Enter a valid email address' });
    if (password.length < 8) return res.status(400).json({ success: false, error: 'Use at least 8 characters' });

    const userCount = await User.countDocuments();
    const firstRun = userCount === 0;

    const email2 = email.toLowerCase().trim();
    const existing = await User.findOne({ email: email2 });
    if (existing) return res.status(400).json({ success: false, error: 'An account with this email already exists' });

    const user = new User({
      name: name.trim(),
      email: email2,
      role: firstRun ? 'admin' : 'user',
      approvalStatus: firstRun ? 'approved' : 'pending'
    });
    await user.setPassword(password);
    await user.save();

    if (!firstRun) {
      return res.status(201).json({
        success: true,
        data: { pending: true, message: 'Your profile has been created. An admin needs to approve your account before you can sign in.' }
      });
    }

    res.status(201).json({ success: true, data: { token: sign(user), user: user.toPublic() } });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, error: 'Email and password are required' });

    const user = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (!user || !(await user.checkPassword(password))) {
      return res.status(401).json({ success: false, error: 'Incorrect email or password' });
    }
    if (user.approvalStatus === 'pending') {
      return res.status(403).json({ success: false, error: 'Your account is awaiting admin approval.' });
    }
    if (user.approvalStatus === 'rejected') {
      return res.status(403).json({ success: false, error: 'Your account request was declined. Contact a workspace admin.' });
    }
    if (!user.active) return res.status(403).json({ success: false, error: 'This account has been disabled' });

    res.json({ success: true, data: { token: sign(user), user: user.toPublic() } });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/me', authenticate, async (req, res) => {
  res.json({ success: true, data: req.user.toPublic() });
});

router.patch('/profile', authenticate, async (req, res) => {
  try {
    const { name, department, title, avatar } = req.body;
    if (name !== undefined) req.user.name = String(name).trim() || req.user.name;
    if (department !== undefined) req.user.department = String(department).trim() || 'General';
    if (title !== undefined) req.user.title = String(title).trim() || 'Member';
    if (avatar !== undefined) {
      if (avatar === '') {
        req.user.avatar = '';
      } else if (typeof avatar !== 'string' || !avatar.startsWith('data:image/')) {
        return res.status(400).json({ success: false, error: 'Invalid image data' });
      } else if (avatar.length > 400000) {
        return res.status(400).json({ success: false, error: 'Image is too large — please use a smaller photo' });
      } else {
        req.user.avatar = avatar;
      }
    }
    await req.user.save();
    res.json({ success: true, data: req.user.toPublic() });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'Current and new password are required' });
    }
    if (newPassword.length < 8) return res.status(400).json({ success: false, error: 'New password must be at least 8 characters' });

    const ok = await req.user.checkPassword(currentPassword);
    if (!ok) return res.status(400).json({ success: false, error: 'Current password is incorrect' });

    await req.user.setPassword(newPassword);
    await req.user.save();
    res.json({ success: true, data: { ok: true } });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
