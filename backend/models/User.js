const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    name: { type: String, default: 'Estudante' }, // Novo campo
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, default: 'user', enum: ['user', 'admin'] } // 'user' ou 'admin'
});

module.exports = mongoose.model('User', UserSchema);