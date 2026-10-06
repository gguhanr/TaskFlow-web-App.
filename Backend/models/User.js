const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true, unique: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['admin', 'user'], default: 'user' },
  department: { type: String, trim: true, default: 'General' },
  title: { type: String, trim: true, default: 'Member' },
  avatar: { type: String, default: '' },
  // Self-registered accounts start 'pending' and can't log in until an
  // admin approves them. The very first account (workspace bootstrap) and
  // any account an admin creates directly default to 'approved'.
  approvalStatus: { type: String, enum: ['approved', 'pending', 'rejected'], default: 'approved' },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

userSchema.methods.setPassword = async function (password) {
  this.passwordHash = await bcrypt.hash(password, 10);
};

userSchema.methods.checkPassword = function (password) {
  return bcrypt.compare(password, this.passwordHash);
};

// Never send passwordHash to the client.
userSchema.methods.toPublic = function () {
  return {
    _id: this._id,
    name: this.name,
    email: this.email,
    role: this.role,
    department: this.department,
    title: this.title,
    avatar: this.avatar || '',
    approvalStatus: this.approvalStatus,
    active: this.active,
    createdAt: this.createdAt
  };
};

module.exports = mongoose.model('User', userSchema);
