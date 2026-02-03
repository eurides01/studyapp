const mongoose = require('mongoose');

const StudyTimeLogSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    id: { type: String, required: true, unique: true },
    editalId: String,
    disciplina: String,
    assunto: String,
    data: String,
    tempoMinutos: Number,
    tipo: String, // 'manual', 'revisao', 'pomodoro'
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('StudyTimeLog', StudyTimeLogSchema);