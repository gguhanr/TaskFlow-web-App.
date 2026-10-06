const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  workspaceName: { type: String, trim: true, default: 'Workspace' }
});

module.exports = mongoose.model('Settings', settingsSchema);
